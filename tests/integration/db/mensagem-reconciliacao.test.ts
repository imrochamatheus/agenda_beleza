import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { conectar, criarCliente, criarProfissional, criarSalao, erroSql, inserirReserva } from '../../support/sql';

// D-024 (E7.1), migrações 20261121200000_tipo_mensagem_convite_avaliacao e 20261121200100_mensagem_reconciliacao.
// Contrato em docs/demandas/D-024/dba.md. CA-23 (enum, UNIQUE) e CA-24 (planos da reconciliação sem Seq Scan).
let c: pg.Client;
let salaoId: string;
let reservaId: string;

beforeAll(async () => {
  c = await conectar();
  salaoId = await criarSalao(c);
  const p = await criarProfissional(c, salaoId);
  const cli = await criarCliente(c, salaoId);
  reservaId = await inserirReserva(c, {
    salaoId,
    profissionalId: p,
    clienteId: cli,
    inicio: '2031-01-10T13:00:00Z',
    fim: '2031-01-10T14:00:00Z',
  });
});

afterAll(async () => {
  await c.end();
});

async function plano(sql: string): Promise<string> {
  await c.query('SET enable_seqscan = off'); // volume de teste é pequeno: força o planejador a preferir índice
  try {
    const r = await c.query<Record<string, string>>(`EXPLAIN ${sql}`);
    return r.rows.map((x) => x['QUERY PLAN']).join('\n');
  } finally {
    await c.query('RESET enable_seqscan');
  }
}

describe('CA-23: enum tipo_mensagem', () => {
  it('aceita convite_avaliacao, uma vez por (reserva, tipo, revisão)', async () => {
    await c.query("INSERT INTO mensagem (salao_id, reserva_id, tipo, revisao) VALUES ($1, $2, 'convite_avaliacao', 0)", [
      salaoId,
      reservaId,
    ]);
    const erro = await erroSql(
      c.query("INSERT INTO mensagem (salao_id, reserva_id, tipo, revisao) VALUES ($1, $2, 'convite_avaliacao', 0)", [
        salaoId,
        reservaId,
      ]),
    );
    expect(erro.code).toBe('23505');
  });

  it('recusa tipo desconhecido', async () => {
    const erro = await erroSql(
      c.query("INSERT INTO mensagem (salao_id, reserva_id, tipo, revisao) VALUES ($1, $2, 'lembrete', 0)", [
        salaoId,
        reservaId,
      ]),
    );
    expect(erro.code).toBe('22P02');
  });
});

describe('mensagem_revisao_chk', () => {
  it('recusa revisão negativa e aceita zero', async () => {
    const erro = await erroSql(
      c.query("INSERT INTO mensagem (salao_id, reserva_id, tipo, revisao) VALUES ($1, $2, 'cancelamento', -1)", [
        salaoId,
        reservaId,
      ]),
    );
    expect(erro).toEqual({ code: '23514', constraint: 'mensagem_revisao_chk' });
    await c.query("INSERT INTO mensagem (salao_id, reserva_id, tipo, revisao) VALUES ($1, $2, 'cancelamento', 0)", [
      salaoId,
      reservaId,
    ]);
  });
});

describe('CA-24: planos da reconciliação com volume', () => {
  beforeAll(async () => {
    // 20 000 mensagens, 99% enviadas; as restantes pendentes/enviando antigas e recentes.
    await c.query(
      `INSERT INTO mensagem (salao_id, reserva_id, tipo, revisao, estado, atualizado_em)
       SELECT $1, $2, 'confirmacao', 1000 + g,
              (CASE WHEN g % 100 = 0 THEN 'pendente' WHEN g % 100 = 1 THEN 'enviando' ELSE 'enviada' END)::estado_mensagem,
              now() - (g || ' minutes')::interval
       FROM generate_series(1, 20000) g`,
      [salaoId, reservaId],
    );
    await c.query('ANALYZE mensagem');
  });

  it.each(['pendente', 'enviando'])('estado %s: usa o índice parcial, sem Seq Scan e sem Sort', async (estado) => {
    const p = await plano(
      `SELECT id FROM mensagem WHERE estado = '${estado}' AND atualizado_em < now() - interval '5 minutes'
       ORDER BY atualizado_em LIMIT 100`,
    );
    expect(p).toContain('mensagem_reconciliacao_idx');
    expect(p).not.toContain('Seq Scan');
    expect(p).not.toContain('Sort');
  });

  it('sem forçar o planejador, o plano continua no índice parcial', async () => {
    const r = await c.query<Record<string, string>>(
      `EXPLAIN SELECT id FROM mensagem WHERE estado = 'pendente' AND atualizado_em < now() - interval '5 minutes'
       ORDER BY atualizado_em LIMIT 100`,
    );
    expect(r.rows.map((x) => x['QUERY PLAN']).join('\n')).toContain('mensagem_reconciliacao_idx');
  });

  it('listagem por reserva usa (salao_id, reserva_id)', async () => {
    const p = await plano(`SELECT id FROM mensagem WHERE salao_id = '${salaoId}' AND reserva_id = '${reservaId}'`);
    expect(p).not.toContain('Seq Scan');
  });
});
