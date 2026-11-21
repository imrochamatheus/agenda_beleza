import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { conectar } from '../../../support/sql';

// D-034 T-1: coluna de anti-replay e CHECKs do segundo fator (docs/demandas/D-034/dba.md).
let c: pg.Client;
beforeAll(async () => {
  c = await conectar();
});
afterAll(async () => {
  await c.end();
});

async function inserir(extra: { segredo: string | null; ativado: boolean; passo: number | null }) {
  const email = `admin-${Math.random().toString(36).slice(2)}@exemplo.test`;
  return c.query(
    `INSERT INTO usuario (papel, email, nome, senha_hash, totp_segredo_cifrado, totp_ativado_em, totp_ultimo_passo)
     VALUES ('super_admin', $1, 'A', 'h', $2, CASE WHEN $3::boolean THEN now() END, $4) RETURNING id`,
    [email, extra.segredo, extra.ativado, extra.passo],
  );
}

describe('esquema TOTP do super admin', () => {
  it('a coluna totp_ultimo_passo é bigint anulável', async () => {
    const r = await c.query(
      `SELECT data_type, is_nullable FROM information_schema.columns
       WHERE table_name = 'usuario' AND column_name = 'totp_ultimo_passo'`,
    );
    expect(r.rows).toEqual([{ data_type: 'bigint', is_nullable: 'YES' }]);
  });

  it('sessao tem revogada_em e índice por usuario_id', async () => {
    const col = await c.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name='sessao' AND column_name='revogada_em'`,
    );
    expect(col.rowCount).toBe(1);
    const ix = await c.query(`SELECT 1 FROM pg_indexes WHERE indexname = 'sessao_usuario_id_idx'`);
    expect(ix.rowCount).toBe(1);
  });

  it('recusa TOTP ativado sem segredo (usuario_totp_ativado_chk)', async () => {
    await expect(inserir({ segredo: null, ativado: true, passo: null })).rejects.toMatchObject({
      code: '23514',
      constraint: 'usuario_totp_ativado_chk',
    });
  });

  it('aceita segredo pendente (sem ativação) e ativado com segredo', async () => {
    await inserir({ segredo: 'v1:a:b:c', ativado: false, passo: null });
    await inserir({ segredo: 'v1:a:b:c', ativado: true, passo: 57000000 });
  });

  it('recusa passo negativo (usuario_totp_passo_chk)', async () => {
    await expect(inserir({ segredo: 'v1:a:b:c', ativado: true, passo: -1 })).rejects.toMatchObject({
      code: '23514',
      constraint: 'usuario_totp_passo_chk',
    });
  });

  it('o UPDATE de anti-replay avança uma única vez por passo', async () => {
    const id = (await inserir({ segredo: 'v1:a:b:c', ativado: true, passo: null })).rows[0].id;
    const sql = `UPDATE usuario SET totp_ultimo_passo = $2
                 WHERE id = $1 AND (totp_ultimo_passo IS NULL OR totp_ultimo_passo < $2)`;
    expect((await c.query(sql, [id, 100])).rowCount).toBe(1);
    expect((await c.query(sql, [id, 100])).rowCount).toBe(0);
    expect((await c.query(sql, [id, 99])).rowCount).toBe(0);
    expect((await c.query(sql, [id, 101])).rowCount).toBe(1);
  });
});
