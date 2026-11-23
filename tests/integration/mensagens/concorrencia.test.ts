import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { reenviarMensagem } from '@/server/mensagens/reenviar';
import { criarReconciliarMensagens } from '@/worker/handlers/reconciliar-mensagens';
import type { ContextoJob } from '@/worker/handlers/tipos';
import { repos } from '@/server/repos';
import { obterPrisma } from '@/server/repos/db';
import { emTransacao } from '@/server/repos/transacao';

import { criarCenarioMensagem, criarMensagem, lerMensagem, mensagensDaReservaDireto, mudarReserva } from '../../support/mensagens';
import { telefoneNovo } from '../../support/sql';

import { criarPipeline, ctxDo, esperarMensagem, registrar } from './apoio';
import type { Pipeline } from './apoio';

// D-024 T-7: CA-25 (concorrência): sem impasse, sem 23505, sem 5xx; uma linha por reserva:tipo:revisao;
// nenhuma enviando sem tentativa aberta. Estabilidade ×10 no comando documentado.

let p: Pipeline;
const MIN = 60_000;
const ctxJob = (): ContextoJob => ({ id: 'j', fila: 'reconciliar-mensagens', tentativa: 1, tentativasMaximas: 5, agendadoPara: new Date(), sinal: new AbortController().signal, log: () => {} });

beforeAll(async () => {
  p = await criarPipeline();
}, 60_000);
afterAll(async () => {
  await p?.encerrar();
});

function semFalha<T>(rs: PromiseSettledResult<T>[]) {
  const falhas = rs.filter((r): r is PromiseRejectedResult => r.status === 'rejected').map((r) => String(r.reason));
  expect(falhas).toEqual([]);
}

async function enviandoSemTentativaAberta(salaoId: string): Promise<number> {
  const [r] = await obterPrisma().$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n FROM mensagem m
     WHERE m.salao_id = ${salaoId}::uuid AND m.estado = 'enviando'
       AND NOT EXISTS (SELECT 1 FROM mensagem_tentativa t WHERE t.mensagem_id = m.id AND t.resultado IS NULL)`;
  return r.n;
}

describe('CA-25: registros concorrentes', () => {
  it('registros de revisões distintas + substituirNaoVigentes em paralelo: sem impasse nem 23505, uma linha por chave', async () => {
    const s = await criarCenarioMensagem({ revisao: 1 });
    // D-050: os itens estão na revisão 106, logo só a remarcação 106 é vigente (RN-30).
    await mudarReserva(s.reservaId, { revisao: 106 });
    for (let rev = 0; rev < 3; rev++) {
      await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, tipo: 'remarcacao', revisao: 100 + rev });
    }
    const conf = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, tipo: 'confirmacao', revisao: 0 });
    const resultados = await Promise.allSettled(
      Array.from({ length: 12 }, (_, i) => {
        const revisao = 101 + (i % 6); // repete revisões: há chaves iguais e distintas ao mesmo tempo
        return emTransacao(async (r) => {
          const { criada } = await r.mensagens.inserir(
            ctxDo(s),
            { reservaId: s.reservaId, tipo: 'remarcacao', revisao, estado: 'pendente', erroCodigo: null, destinatarioE164: s.telefone },
            new Date(),
          );
          await r.mensagens.substituirNaoVigentes(ctxDo(s), s.reservaId, new Date());
          return criada;
        });
      }),
    );
    semFalha(resultados);
    const linhas = await mensagensDaReservaDireto(s.reservaId);
    const chaves = linhas.map((m) => `${m.tipo}:${m.revisao}`);
    expect(new Set(chaves).size).toBe(chaves.length);
    // A vigente (106) nunca é substituída; a confirmação continua vigente (RN-31); as pendentes anteriores
    // ao paralelismo foram substituídas. (Uma revisão não vigente inserida DEPOIS do último UPDATE pode
    // ficar pendente: o envio a trata como obsoleta, RN-30.)
    expect(linhas.find((m) => m.tipo === 'remarcacao' && m.revisao === 106)?.estado).toBe('pendente');
    expect((await lerMensagem(conf)).estado).toBe('pendente');
    expect(linhas.find((m) => m.tipo === 'remarcacao' && m.revisao === 100)?.estado).toBe('substituida');
  });

  it('registrar × edição de telefone × upsert da mesma cliente × reenviar × reconciliação, todos juntos', async () => {
    const s = await criarCenarioMensagem({ revisao: 2 });
    const falhou = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, tipo: 'remarcacao', revisao: 2, estado: 'falhou', destinatarioE164: s.telefone, atualizadoEm: new Date(Date.now() - 10 * MIN) });
    await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, tipo: 'remarcacao', revisao: 1, estado: 'enviando', atualizadoEm: new Date(Date.now() - 10 * MIN), tentativas: [{ resultado: null }] });
    const db = obterPrisma();
    const novoTelefone = telefoneNovo();
    const acoes: Promise<unknown>[] = [];
    for (let i = 0; i < 6; i++) {
      acoes.push(registrar(s, 'remarcacao'));
      acoes.push(registrar(s, 'cancelamento'));
      acoes.push(registrar(s, 'confirmacao'));
    }
    // edição de telefone: UPDATE da coluna de chave (toma FOR UPDATE da linha), em transação curta
    acoes.push(db.$transaction(async (tx) => tx.$executeRaw`UPDATE cliente SET telefone_e164 = ${novoTelefone} WHERE id = ${s.clienteId}::uuid`));
    acoes.push(repos().clientes.upsert(ctxDo(s), { nome: 'Mesma cliente', telefoneE164: s.telefone }));
    const reenvios = [1, 2].map(() => reenviarMensagem(ctxDo(s), falhou, new Date(), { enfileirar: p.enfileirar }));
    acoes.push(...reenvios);
    acoes.push(criarReconciliarMensagens({ enfileirar: p.enfileirar }).processar({}, ctxJob()));
    semFalha(await Promise.allSettled(acoes));
    expect((await Promise.all(reenvios)).filter((r) => r.resultado === 'reenfileirada')).toHaveLength(1);

    const linhas = await mensagensDaReservaDireto(s.reservaId);
    const chaves = linhas.map((m) => `${m.tipo}:${m.revisao}`);
    expect(new Set(chaves).size).toBe(chaves.length);
    expect(await enviandoSemTentativaAberta(s.salaoId)).toBe(0);
    // O reenvio duplo: uma só reenfileirou; o worker envia a mensagem.
    await esperarMensagem(falhou, 'enviada');
  }, 40_000);

  it('dois reenvios da mesma falhou: exatamente um reenfileira, o outro é recusado', async () => {
    const s = await criarCenarioMensagem();
    const id = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, estado: 'falhou', destinatarioE164: s.telefone });
    const rs = await Promise.all([1, 2, 3, 4].map(() => reenviarMensagem(ctxDo(s), id, new Date(), { enfileirar: p.enfileirar })));
    expect(rs.filter((r) => r.resultado === 'reenfileirada')).toHaveLength(1);
    expect(rs.filter((r) => r.resultado === 'recusada' && r.motivo === 'nao_falhou')).toHaveLength(3);
    await esperarMensagem(id, 'enviada');
    expect((await lerMensagem(id)).estado).toBe('enviada');
  }, 40_000);
});
