import type pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { anonimizarCliente } from '@/server/clientes/anonimizar';
import { marcarStatusReserva } from '@/server/reservas/marcar-status';
import { lerAvaliacoesPublicas } from '@/server/avaliacoes/leitura';

import type { SalaoCompleto } from '../../support/factories';
import { conectar } from '../../support/sql';
import { ctxDoGestor } from '../clientes/apoio';

import { AGORA, criarAvaliavel, ctxPublico, emitirLink, enviar, salaoNovo } from './apoio';

// D-032 T-8: concorrência do envio com PostgreSQL real (CA-10, R-1). Dez ou mais envios do MESMO link
// (com e sem barreira) = exatamente uma avaliação; envio × anonimização × mudança de status sem impasse
// (40P01), sem 23505 e com estado final coerente; casos determinísticos com pg_stat_activity.

const TIMEOUT = 60_000;
/** Depois do fim de qualquer reserva criada por `criarAvaliavel` (que usa o relógio real + dias). */
const DEPOIS_DO_ATENDIMENTO = new Date(Date.now() + 400 * 86_400_000);
const enfileirar = async () => ({ criado: true as const, id: 'job' });
const VEZES = 10;
let c: pg.Client;
let trava: pg.Client;
let s: SalaoCompleto;

beforeAll(async () => {
  c = await conectar();
  trava = await conectar();
  s = await salaoNovo();
});
afterAll(async () => {
  await trava.end();
  await c.end();
});
beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

async function esperando(marcador: string): Promise<number> {
  const { rows } = await c.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE datname = current_database() AND pid <> pg_backend_pid()
        AND wait_event_type = 'Lock' AND query LIKE $1`,
    [`%${marcador}%`],
  );
  return rows[0].n;
}
async function aguardarEsperando(marcador: string, n = 1): Promise<void> {
  const limite = Date.now() + 10_000;
  while ((await esperando(marcador)) < n) {
    if (Date.now() > limite) throw new Error(`esperava ${n} consulta(s) bloqueada(s) em "${marcador}"`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

function barreira(n: number): () => Promise<void> {
  let chegaram = 0;
  let liberar!: () => void;
  const porta = new Promise<void>((r) => (liberar = r));
  return async () => {
    chegaram += 1;
    if (chegaram >= n) liberar();
    await porta;
  };
}

const semFalha = (rs: PromiseSettledResult<unknown>[]) => {
  for (const r of rs) expect(r.status, r.status === 'rejected' ? String(r.reason) : '').toBe('fulfilled');
};

describe('CA-10: o mesmo link em paralelo', () => {
  it.each([
    ['10 sem barreira', 10, false],
    ['12 com barreira depois das travas (todos já validaram)', 12, true],
  ] as const)('%s ×10: exatamente 1 avaliação, 1 sucesso, o resto link inválido', async (_n, qtd, comBarreira) => {
    for (let i = 0; i < VEZES; i += 1) {
      const k = await criarAvaliavel(c, s);
      const { token } = await emitirLink(s, k.reservaId);
      // A barreira fica ANTES da transação de gravação: todos chegam juntos à disputa pela trava.
      const bar = barreira(qtd);
      const rs = await Promise.allSettled(
        Array.from({ length: qtd }, () => enviar(s, token, {}, AGORA, comBarreira ? { verificarHumano: async () => { await bar(); return true; } } : {})),
      );
      semFalha(rs);
      const valores = rs.map((r) => (r as PromiseFulfilledResult<{ resultado: string }>).value.resultado);
      expect(valores.filter((v) => v === 'enviada')).toHaveLength(1);
      expect(valores.filter((v) => v === 'link_invalido')).toHaveLength(qtd - 1);
      expect((await c.query('SELECT count(*) AS n FROM avaliacao WHERE reserva_id = $1', [k.reservaId])).rows[0].n).toBe('1');
    }
  }, TIMEOUT);
});

describe('R-1: envio × anonimização × mudança de status', () => {
  it('×10: sem impasse nem 23505; estado final coerente (a avaliação aparece só se a reserva ficou concluida e a cliente não foi anonimizada)', async () => {
    for (let i = 0; i < VEZES; i += 1) {
      const k = await criarAvaliavel(c, s);
      const { token } = await emitirLink(s, k.reservaId);
      const rs = await Promise.allSettled([
        enviar(s, token),
        enviar(s, token),
        anonimizarCliente(ctxDoGestor(s), { clienteId: k.clienteId }, AGORA),
        marcarStatusReserva(ctxDoGestor(s), { reservaId: k.reservaId, para: 'nao_compareceu' }, DEPOIS_DO_ATENDIMENTO, { enfileirar }),
      ]);
      const status = rs[3] as PromiseFulfilledResult<{ resultado: string }>;
      expect(['atualizada', 'recusado']).toContain(status.value.resultado);
      const falhas = rs.filter((r) => r.status === 'rejected');
      expect(falhas.map((f) => String((f as PromiseRejectedResult).reason))).toEqual([]);
      const { rows } = await c.query(
        `SELECT a.nome_exibicao, a.comentario FROM avaliacao a WHERE a.reserva_id = $1`, [k.reservaId]);
      const cli = (await c.query('SELECT anonimizada_em FROM cliente WHERE id = $1', [k.clienteId])).rows[0];
      expect(cli.anonimizada_em).not.toBeNull();
      // Se a avaliação foi gravada antes da anonimização, nome e comentário foram apagados.
      for (const r of rows) expect(r).toEqual({ nome_exibicao: null, comentario: null });
      expect(rows.length).toBeLessThanOrEqual(1);
    }
    // Nenhuma avaliação de cliente anonimizada do salão guarda nome ou comentário.
    const { rows: sobras } = await c.query(
      `SELECT 1 FROM avaliacao a JOIN cliente cl ON cl.salao_id = a.salao_id AND cl.id = a.cliente_id
        WHERE a.salao_id = $1 AND cl.anonimizada_em IS NOT NULL AND (a.nome_exibicao IS NOT NULL OR a.comentario IS NOT NULL)`,
      [s.salaoId],
    );
    expect(sobras).toEqual([]);
  }, TIMEOUT);

  it('determinístico: o envio espera a anonimização que segura a cliente; depois recusa (e vice-versa)', async () => {
    const k = await criarAvaliavel(c, s);
    const { token } = await emitirLink(s, k.reservaId);
    await trava.query('BEGIN');
    await trava.query('SELECT id FROM cliente WHERE id = $1 FOR UPDATE', [k.clienteId]);
    const p = enviar(s, token);
    await aguardarEsperando('FOR SHARE');
    await trava.query('UPDATE cliente SET nome = NULL, telefone_e164 = NULL, anonimizada_em = now() WHERE id = $1', [k.clienteId]);
    await trava.query('COMMIT');
    expect(await p).toEqual({ resultado: 'link_invalido' });
    expect((await c.query('SELECT 1 FROM avaliacao WHERE reserva_id = $1', [k.reservaId])).rowCount).toBe(0);
  }, TIMEOUT);

  it('determinístico: a mudança de status espera o envio que segura a reserva (FOR SHARE) até o commit', async () => {
    const t = await salaoNovo();
    const k = await criarAvaliavel(c, t);
    const { token } = await emitirLink(t, k.reservaId);
    let soltar!: () => void;
    const parado = new Promise<void>((r) => (soltar = r));
    let chegou!: () => void;
    const noPonto = new Promise<void>((r) => (chegou = r));
    const envio = enviar(t, token, {}, AGORA, { aposTravar: async () => { chegou(); await parado; } });
    await noPonto;
    // Com o envio segurando reserva e cliente (FOR SHARE), a edição direta da reserva espera.
    const mudanca = trava.query("UPDATE reserva SET status = 'nao_compareceu' WHERE id = $1 /* mudanca */", [k.reservaId]);
    await aguardarEsperando('/* mudanca */');
    soltar();
    expect(await envio).toEqual({ resultado: 'enviada' });
    await mudanca;
    expect((await lerAvaliacoesPublicas(ctxPublico(t), 100)).total).toBe(0);
    await c.query("UPDATE reserva SET status = 'concluido' WHERE id = $1", [k.reservaId]);
    expect((await lerAvaliacoesPublicas(ctxPublico(t), 100)).total).toBe(1);
  }, TIMEOUT);

  it('determinístico: a anonimização espera o envio e depois apaga nome e comentário da avaliação gravada', async () => {
    const k = await criarAvaliavel(c, s);
    const { token } = await emitirLink(s, k.reservaId);
    let soltar!: () => void;
    const parado = new Promise<void>((r) => (soltar = r));
    let chegou!: () => void;
    const noPonto = new Promise<void>((r) => (chegou = r));
    const envio = enviar(s, token, {}, AGORA, { aposTravar: async () => { chegou(); await parado; } });
    await noPonto;
    const anon = anonimizarCliente(ctxDoGestor(s), { clienteId: k.clienteId }, AGORA);
    await aguardarEsperando('FROM cliente');
    soltar();
    expect(await envio).toEqual({ resultado: 'enviada' });
    expect((await anon).resultado).toBe('anonimizada');
    const { rows } = await c.query('SELECT nome_exibicao, comentario FROM avaliacao WHERE reserva_id = $1', [k.reservaId]);
    expect(rows).toEqual([{ nome_exibicao: null, comentario: null }]);
  }, TIMEOUT);
});
