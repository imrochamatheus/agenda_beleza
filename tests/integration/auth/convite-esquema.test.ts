import { randomUUID } from 'node:crypto';

import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { conectar, criarCenario, erroSql } from '../../support/sql';

// D-039 (E1.4), migração 20261125000000_convite_pendente_unico. Contrato em docs/demandas/D-039/dba.md.
let c: pg.Client;
beforeAll(async () => {
  c = await conectar();
});
afterAll(async () => {
  await c.end();
});

function convite(salaoId: string, profissionalId: string, extra = '') {
  return c.query(
    `INSERT INTO convite (salao_id, profissional_id, email, token_hash, expira_em${extra ? ', ' + extra.split('=')[0] : ''})
     VALUES ($1,$2,'a@teste.com',$3, now() + interval '7 days'${extra ? ', ' + extra.split('=')[1] : ''}) RETURNING id`,
    [salaoId, profissionalId, randomUUID()],
  );
}

describe('um convite pendente por profissional', () => {
  it('dois pendentes do mesmo profissional: o segundo falha com 23505 no índice parcial', async () => {
    const cen = await criarCenario(c);
    await convite(cen.salaoId, cen.profissionalId);
    const e = await erroSql(convite(cen.salaoId, cen.profissionalId));
    expect(e.code).toBe('23505');
    expect(e.constraint).toBe('convite_pendente_por_profissional_uniq');
  });

  it('vencido e não invalidado continua ocupando o índice', async () => {
    const cen = await criarCenario(c);
    const r = await convite(cen.salaoId, cen.profissionalId);
    await c.query(`UPDATE convite SET expira_em = now() - interval '1 day' WHERE id = $1`, [r.rows[0].id]);
    expect((await erroSql(convite(cen.salaoId, cen.profissionalId))).code).toBe('23505');
  });

  it('aceito ou invalidado não bloqueiam; invalidar libera o novo pendente', async () => {
    const cen = await criarCenario(c);
    await convite(cen.salaoId, cen.profissionalId, 'aceito_em=now()');
    await convite(cen.salaoId, cen.profissionalId, 'invalidado_em=now()');
    await convite(cen.salaoId, cen.profissionalId, 'invalidado_em=now()');
    const p = await convite(cen.salaoId, cen.profissionalId);
    await c.query(`UPDATE convite SET invalidado_em = now() WHERE id = $1`, [p.rows[0].id]);
    await convite(cen.salaoId, cen.profissionalId);
  });

  it('outro profissional (e outro salão) não conflita', async () => {
    const a = await criarCenario(c);
    const b = await criarCenario(c);
    await convite(a.salaoId, a.profissionalId);
    await convite(b.salaoId, b.profissionalId);
  });
});
