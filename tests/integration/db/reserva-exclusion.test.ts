import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { conectar, criarCenario, erroSql } from '../../support/sql';

// D-004 CA-2..CA-8 mudaram de tabela na D-050: a anti-sobreposição está em reserva_item
// (reserva-item-exclusion.test.ts). Aqui fica o que sobra de `reserva`: envelope DERIVADO
// (inicio/fim/status gravados pela aplicação), sem profissional, sem ocupação e sem exclusion.
let c: pg.Client;

beforeAll(async () => {
  c = await conectar();
});

afterAll(async () => {
  await c.end();
});

function inserirReserva(
  s: { salaoId: string; clienteId: string },
  inicio: string,
  fim: string,
  status = 'confirmado',
) {
  return c.query<{ id: string }>(
    `INSERT INTO reserva (salao_id, cliente_id, inicio, fim, status, origem)
     VALUES ($1, $2, $3, $4, $5::status_reserva, 'publico') RETURNING id`,
    [s.salaoId, s.clienteId, inicio, fim, status],
  );
}

describe('reserva depois da D-050', () => {
  it('reserva_sem_sobreposicao, profissional_id, ocupado_ate e encaixe não existem mais em reserva', async () => {
    const r = await c.query(
      `SELECT conname FROM pg_constraint WHERE conname IN ('reserva_sem_sobreposicao', 'reserva_salao_id_profissional_id_fkey')`,
    );
    expect(r.rows).toEqual([]);
    const col = await c.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'reserva' ORDER BY column_name`,
    );
    expect(col.rows.map((x) => x.column_name)).toEqual([
      'atualizado_em',
      'cancelada_em',
      'chave_requisicao',
      'cliente_id',
      'criado_em',
      'fim',
      'id',
      'inicio',
      'origem',
      'revisao',
      'salao_id',
      'status',
    ]);
    const idx = await c.query(`SELECT 1 FROM pg_class WHERE relname = 'reserva_salao_id_profissional_id_inicio_idx'`);
    expect(idx.rows).toEqual([]);
  });

  it('a reserva não impede envelopes sobrepostos (a garantia é dos itens)', async () => {
    const s = await criarCenario(c);
    await inserirReserva(s, '2026-12-01T10:00:00Z', '2026-12-01T11:00:00Z');
    await inserirReserva(s, '2026-12-01T10:30:00Z', '2026-12-01T11:30:00Z');
    const r = await c.query<{ n: number }>('SELECT count(*)::int AS n FROM reserva WHERE cliente_id = $1', [s.clienteId]);
    expect(r.rows[0].n).toBe(2);
  });

  it('reserva_ordem_chk mantém só fim > inicio', async () => {
    const [def] = (
      await c.query<{ def: string }>(
        "SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'reserva_ordem_chk'",
      )
    ).rows;
    expect(def.def).toBe('CHECK ((fim > inicio))');
  });

  it.each([
    ['fim = inicio', '2026-12-01T10:00:00Z', '2026-12-01T10:00:00Z'],
    ['fim < inicio', '2026-12-01T10:00:00Z', '2026-12-01T09:00:00Z'],
  ])('CA-8: %s é rejeitado pelo CHECK com 23514', async (_caso, inicio, fim) => {
    const s = await criarCenario(c);
    expect(await erroSql(inserirReserva(s, inicio, fim))).toEqual({ code: '23514', constraint: 'reserva_ordem_chk' });
  });
});
