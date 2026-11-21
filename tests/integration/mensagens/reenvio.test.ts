import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { reenviarMensagem } from '@/server/mensagens/reenviar';
import { obterPrisma } from '@/server/repos/db';

import {
  anonimizarCliente,
  chamadasDaChave,
  criarCenarioMensagem,
  criarMensagem,
  lerMensagem,
  lerTentativas,
  mensagensDaReservaDireto,
  mudarReserva,
} from '../../support/mensagens';

import { criarPipeline, ctxDo, esperarMensagem, limparFalhasForcadas, registrarEEnfileirar } from './apoio';
import type { Pipeline } from './apoio';

// D-024 T-7: CA-6 (reenvio manual de mensagem falhou).

let p: Pipeline;
beforeAll(async () => {
  p = await criarPipeline();
}, 60_000);
afterAll(async () => {
  await p?.encerrar();
});
afterEach(limparFalhasForcadas);

const reenviar = (s: { salaoId: string }, id: string) => reenviarMensagem(ctxDo(s), id, new Date(), { enfileirar: p.enfileirar });

describe('CA-6: falhou → reenviada → enviada', () => {
  it('reenfileirada com a mesma chave; mensagem e reserva não ganham linha; tentativas antigas ficam e a nova é a seguinte', async () => {
    const s = await criarCenarioMensagem();
    await p.simulado.forcarFalhas(1, 'permanente');
    const r = await registrarEEnfileirar(p, s, 'confirmacao');
    await esperarMensagem(r.mensagemId, 'falhou');
    const antes = await obterPrisma().$queryRaw<{ m: number; r: number }[]>`
      SELECT (SELECT count(*)::int FROM mensagem WHERE salao_id = ${s.salaoId}::uuid) AS m,
             (SELECT count(*)::int FROM reserva WHERE salao_id = ${s.salaoId}::uuid) AS r`;
    const jobsAntes = p.jobs.length;

    const resultado = await reenviar(s, r.mensagemId);
    expect(resultado).toEqual({ resultado: 'reenfileirada', mensagemId: r.mensagemId, chave: r.chave });
    await esperarMensagem(r.mensagemId, 'enviada');

    const t = await lerTentativas(r.mensagemId);
    expect(t.map((x) => [x.numero, x.resultado])).toEqual([[1, 'falha'], [2, 'sucesso']]);
    const depois = await obterPrisma().$queryRaw<{ m: number; r: number }[]>`
      SELECT (SELECT count(*)::int FROM mensagem WHERE salao_id = ${s.salaoId}::uuid) AS m,
             (SELECT count(*)::int FROM reserva WHERE salao_id = ${s.salaoId}::uuid) AS r`;
    expect(depois).toEqual(antes);
    expect(p.jobs.length).toBe(jobsAntes + 1);
    const job = await obterPrisma().$queryRaw<{ singleton_key: string }[]>`SELECT singleton_key FROM pgboss.job WHERE id = ${p.jobs.at(-1)!}::uuid`;
    expect(job[0].singleton_key).toBe(r.chave);
    expect(await chamadasDaChave(r.chave)).toHaveLength(2);
    expect((await lerMensagem(r.mensagemId)).erroCodigo).toBeNull();
  }, 40_000);

  it('falhou com resultado_incerto também pode ser reenviada (decisão humana)', async () => {
    const s = await criarCenarioMensagem();
    const id = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, estado: 'falhou', erroCodigo: 'resultado_incerto', tentativas: [{ resultado: 'falha', erroCodigo: 'resultado_incerto' }] });
    expect((await reenviar(s, id)).resultado).toBe('reenfileirada');
    await esperarMensagem(id, 'enviada');
    expect((await lerTentativas(id)).map((t) => t.numero)).toEqual([1, 2]);
  });
});

describe('CA-6: o que nunca é reenviado', () => {
  it.each(['enviada', 'nao_enviada', 'substituida', 'pendente', 'enviando', 'cancelada_anonimizacao'] as const)('%s → recusada/nao_falhou, sem job e sem chamada', async (estado) => {
    const s = await criarCenarioMensagem();
    const id = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, estado });
    const jobs = p.jobs.length;
    expect(await reenviar(s, id)).toEqual({ resultado: 'recusada', motivo: 'nao_falhou' });
    expect(p.jobs.length).toBe(jobs);
    expect(await chamadasDaChave(`${s.reservaId}:confirmacao:0`)).toEqual([]);
    expect((await lerMensagem(id)).estado).toBe(estado);
  });

  it('revisão já superada → recusada/obsoleta e continua falhou', async () => {
    const s = await criarCenarioMensagem({ revisao: 0 });
    const id = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, estado: 'falhou' });
    await mudarReserva(s.reservaId, { revisao: 1 });
    expect(await reenviar(s, id)).toEqual({ resultado: 'recusada', motivo: 'obsoleta' });
    expect((await lerMensagem(id)).estado).toBe('falhou');
  });

  it('cliente anonimizada → recusada/cliente_anonimizada e a linha vira cancelada_anonimizacao', async () => {
    const s = await criarCenarioMensagem();
    const id = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, estado: 'falhou', destinatarioE164: s.telefone });
    await anonimizarCliente(s.clienteId);
    expect(await reenviar(s, id)).toEqual({ resultado: 'recusada', motivo: 'cliente_anonimizada' });
    expect(await lerMensagem(id)).toMatchObject({ estado: 'cancelada_anonimizacao', destinatarioE164: null });
    expect(await mensagensDaReservaDireto(s.reservaId)).toHaveLength(1);
  });
});
