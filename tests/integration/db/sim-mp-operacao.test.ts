import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { conectar } from '../../support/sql';

// D-042 T-1: o enum sim_mp_operacao aceita 'urlAtualizarMeioPagamento' (o `migrate diff` sem diferença fica em drift.test.ts).
let c: pg.Client;

beforeAll(async () => {
  c = await conectar();
});

afterAll(async () => {
  await c.end();
});

describe('sim_mp_operacao', () => {
  it('contém o valor novo, no fim, e o aceita como literal', async () => {
    const r = await c.query("SELECT enum_range(NULL::sim_mp_operacao)::text[] AS v, 'urlAtualizarMeioPagamento'::sim_mp_operacao::text AS x");
    expect(r.rows[0].x).toBe('urlAtualizarMeioPagamento');
    expect(r.rows[0].v.at(-1)).toBe('urlAtualizarMeioPagamento');
  });
});
