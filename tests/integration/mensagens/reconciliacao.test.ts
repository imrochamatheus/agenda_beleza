import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { enfileirarMensagens } from '@/server/mensagens/enfileirar';
import { criarClienteFila } from '@/server/queue/client';
import { obterPrisma } from '@/server/repos/db';
import { criarReconciliarMensagens } from '@/worker/handlers/reconciliar-mensagens';
import type { ContextoJob } from '@/worker/handlers/tipos';

import { capturarConsole, chamadasDaChave, criarCenarioMensagem, criarMensagem, lerMensagem, lerTentativas } from '../../support/mensagens';

import { criarPipeline, esperarJob, esperarMensagem, limparFalhasForcadas, registrar } from './apoio';
import type { Pipeline } from './apoio';

// D-024 T-7: reconciliação. CA-8 (pendente sem job; chave_em_uso; fila indisponível) e CA-10
// (enviando presa; reentrega sem envio). A reconciliação roda direto (handler com a fila real) e
// também como job do worker.

let p: Pipeline;
const MIN = 60_000;
const atras = (ms: number) => new Date(Date.now() - ms);
const ctxJob = (): ContextoJob => ({ id: 'j', fila: 'reconciliar-mensagens', tentativa: 1, tentativasMaximas: 5, agendadoPara: new Date(), sinal: new AbortController().signal, log: vi.fn() });
const reconciliar = () => criarReconciliarMensagens({ enfileirar: p.enfileirar }).processar({}, ctxJob());

beforeAll(async () => {
  p = await criarPipeline({ reconciliacao: true });
}, 60_000);
afterAll(async () => {
  await p?.encerrar();
});
afterEach(limparFalhasForcadas);

describe('CA-8: pendente sem job', () => {
  it('a reconciliação cria o job e, com o worker, a mensagem fica enviada (1 chamada)', async () => {
    const s = await criarCenarioMensagem();
    const id = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, destinatarioE164: s.telefone, atualizadoEm: atras(3 * MIN) });
    await reconciliar();
    await esperarMensagem(id, 'enviada');
    expect(await chamadasDaChave(`${s.reservaId}:confirmacao:0`)).toHaveLength(1);
  });

  it('o job do cron/fila reconciliar-mensagens faz o mesmo e registra só números', async () => {
    const s = await criarCenarioMensagem();
    const id = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, destinatarioE164: s.telefone, atualizadoEm: atras(3 * MIN) });
    const r = await p.enfileirar('reconciliar-mensagens', {});
    if (r.criado) await esperarJob(p, 'reconciliar-mensagens', r.id);
    await esperarMensagem(id, 'enviada');
    const eventos = p.logs().map((l) => JSON.parse(l) as Record<string, unknown>).filter((e) => e.evento === 'mensagem.reconciliacao');
    expect(eventos.length).toBeGreaterThan(0);
    for (const e of eventos) {
      expect(Object.keys(e).sort()).toEqual(['em', 'enviandoFechadas', 'evento', 'filaIndisponivel', 'jaNaFila', 'pendentesExaminadas', 'reenfileiradas']);
    }
  });

  it('pendente dentro do prazo não é tocada', async () => {
    const s = await criarCenarioMensagem();
    const id = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, destinatarioE164: s.telefone, atualizadoEm: atras(30_000) });
    await reconciliar();
    expect((await lerMensagem(id)).estado).toBe('pendente');
    expect(await chamadasDaChave(`${s.reservaId}:confirmacao:0`)).toEqual([]);
  });

  it('já há job ativo para a chave: não cria outro (chave_em_uso) e o adaptador recebe 1 chamada', async () => {
    const s = await criarCenarioMensagem();
    await p.parar();
    const r = await registrar(s, 'confirmacao');
    await obterPrisma().mensagem.update({ where: { id: r.mensagemId }, data: { atualizadoEm: atras(3 * MIN) } });
    await enfileirarMensagens([r], { enfileirar: p.enfileirar });
    const antes = p.jobs.length;
    await reconciliar();
    await reconciliar();
    expect(p.jobs.length).toBe(antes);
    await p.iniciar();
    await esperarMensagem(r.mensagemId, 'enviada');
    expect(await chamadasDaChave(r.chave)).toHaveLength(1);
  }, 40_000);

  it('fila indisponível: enfileirarMensagens não lança, deixa a linha pendente e registra só IDs', async () => {
    const s = await criarCenarioMensagem();
    const r = await registrar(s, 'confirmacao');
    const fora = criarClienteFila({ ...process.env, DATABASE_URL: 'postgres://usuario:senha@127.0.0.1:1/inexistente', QUEUE_RETRY_DELAY_SECONDS: '1' });
    const log = capturarConsole();
    try {
      await expect(enfileirarMensagens([r], { enfileirar: (f, pl, o) => fora.enfileirar(f, pl, o) })).resolves.toBeUndefined();
    } finally {
      log.restaurar();
      await fora.encerrar();
    }
    expect((await lerMensagem(r.mensagemId)).estado).toBe('pendente');
    expect(log.linhas.some((l) => l.includes('mensagem.fila_indisponivel') && l.includes(r.mensagemId))).toBe(true);
    expect(log.linhas.join('\n')).not.toMatch(/senha|usuario|127\.0\.0\.1/);
  }, 30_000);
});

describe('CA-10: enviando presa e job reentregue', () => {
  it('enviando além do prazo vira falhou/resultado_incerto, a tentativa aberta falha, sem job e sem chamada', async () => {
    const s = await criarCenarioMensagem();
    const id = await criarMensagem({
      salaoId: s.salaoId, reservaId: s.reservaId, estado: 'enviando', destinatarioE164: s.telefone, atualizadoEm: atras(6 * MIN),
      tentativas: [{ resultado: 'falha', erroCodigo: 'x' }, { resultado: null }],
    });
    const dentro = await criarMensagem({
      salaoId: s.salaoId, reservaId: s.reservaId, tipo: 'remarcacao', revisao: 1, estado: 'enviando', destinatarioE164: s.telefone, atualizadoEm: atras(MIN),
      tentativas: [{ resultado: null }],
    });
    const jobsAntes = p.jobs.length;
    await reconciliar();
    expect(await lerMensagem(id)).toMatchObject({ estado: 'falhou', erroCodigo: 'resultado_incerto' });
    const t = await lerTentativas(id);
    expect(t[1]).toMatchObject({ resultado: 'falha', erroCodigo: 'resultado_incerto' });
    expect(t[1].finalizadaEm).toBeInstanceOf(Date);
    expect(t[0].erroCodigo).toBe('x');
    expect((await lerMensagem(dentro)).estado).toBe('enviando');
    expect((await lerTentativas(dentro))[0].resultado).toBeNull();
    expect(p.jobs.length).toBe(jobsAntes);
    expect(await chamadasDaChave(`${s.reservaId}:confirmacao:0`)).toEqual([]);
  });

  it('job reentregue encontra enviando ou falhou/resultado_incerto: termina sem enviar', async () => {
    const s = await criarCenarioMensagem();
    const enviando = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, estado: 'enviando', destinatarioE164: s.telefone, tentativas: [{ resultado: null }] });
    const incerta = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, tipo: 'remarcacao', revisao: 1, estado: 'falhou', erroCodigo: 'resultado_incerto', destinatarioE164: s.telefone, tentativas: [{ resultado: 'falha', erroCodigo: 'resultado_incerto' }] });
    const reentregas = [
      [enviando, 'confirmacao:0'],
      [incerta, 'remarcacao:1'],
    ] as const;
    for (const [id, sufixo] of reentregas) {
      const r = await p.enfileirar('whatsapp-reserva', { mensagemId: id }, { chave: `${s.reservaId}:${sufixo}` });
      if (!r.criado) throw new Error('job não criado');
      expect((await esperarJob(p, 'whatsapp-reserva', r.id)).state).toBe('completed');
    }
    expect(await chamadasDaChave(`${s.reservaId}:confirmacao:0`)).toEqual([]);
    expect(await chamadasDaChave(`${s.reservaId}:remarcacao:1`)).toEqual([]);
    expect((await lerMensagem(enviando)).estado).toBe('enviando');
    expect((await lerMensagem(incerta)).estado).toBe('falhou');
    const ignoradas = p.logs().filter((l) => l.includes('mensagem.nao_reivindicada'));
    expect(ignoradas.length).toBeGreaterThanOrEqual(2);
  });

  it('reconciliar duas vezes é idempotente', async () => {
    const s = await criarCenarioMensagem();
    const id = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, estado: 'enviando', atualizadoEm: atras(10 * MIN), tentativas: [{ resultado: null }] });
    await reconciliar();
    const depois = await lerMensagem(id);
    await reconciliar();
    expect(await lerMensagem(id)).toEqual(depois);
    expect(await lerTentativas(id)).toHaveLength(1);
  });
});
