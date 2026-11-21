import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { criarSalaoCompleto } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { conectar, erroSql } from '../../support/sql';

import { inserirCliente } from './apoio';

// D-023 T-5: CA-16, o banco é a última defesa (SQL direto pelo driver pg: err.code chega sem embrulho).

let c: pg.Client;
let s: SalaoCompleto;
let clienteId: string;

beforeAll(async () => {
  c = await conectar();
  s = await criarSalaoCompleto();
  clienteId = await inserirCliente(c, s.salaoId, 'Banco');
});
afterAll(async () => {
  await c.end();
});

const inserir = (finalidade: string | null, origem: string, versao: string) =>
  c.query(
    `INSERT INTO consentimento (salao_id, cliente_id, finalidade, origem, versao_termos)
     VALUES ($1, $2, $3::text::finalidade_consentimento, $4, $5)`,
    [s.salaoId, clienteId, finalidade, origem, versao],
  );

describe('CA-16: constraints do banco', () => {
  it('finalidade fora do enum → 22P02', async () => {
    expect((await erroSql(inserir('outra', 'publico', 'v1'))).code).toBe('22P02');
  });

  it('sem finalidade (sem DEFAULT) → 23502', async () => {
    const erro = await erroSql(
      c.query("INSERT INTO consentimento (salao_id, cliente_id, origem, versao_termos) VALUES ($1, $2, 'publico', 'v1')", [s.salaoId, clienteId]),
    );
    expect(erro.code).toBe('23502');
  });

  it.each(['convite_avaliacao', 'publicacao_avaliacao'])('%s com origem equipe → 23514 (origem × finalidade)', async (finalidade) => {
    const erro = await erroSql(inserir(finalidade, 'equipe', 'v1'));
    expect(erro).toEqual({ code: '23514', constraint: 'consentimento_origem_finalidade_chk' });
  });

  it.each(['', 'V1', 'a'.repeat(41), 'com espaco', 'ç'])('versão %j → 23514', async (versao) => {
    const erro = await erroSql(inserir('mensagens_reserva', 'publico', versao));
    expect(erro).toEqual({ code: '23514', constraint: 'consentimento_versao_termos_chk' });
  });

  it('combinações válidas são aceitas (versão de 40 caracteres inclusive)', async () => {
    await inserir('mensagens_reserva', 'equipe', 'v1');
    await inserir('convite_avaliacao', 'publico', 'a'.repeat(40));
    await inserir('publicacao_avaliacao', 'publico', '2026-11-21-provisorio');
  });

  it('a coluna não tem DEFAULT e o índice de vigente existe; o antigo saiu', async () => {
    const col = await c.query("SELECT column_default FROM information_schema.columns WHERE table_name = 'consentimento' AND column_name = 'finalidade'");
    expect(col.rows[0].column_default).toBeNull();
    const idx = await c.query("SELECT indexname FROM pg_indexes WHERE tablename = 'consentimento' ORDER BY 1");
    const nomes = idx.rows.map((r) => r.indexname);
    expect(nomes).toContain('consentimento_vigente_idx');
    expect(nomes).not.toContain('consentimento_salao_id_cliente_id_idx');
  });
});

describe('CA-16: linhas anteriores à migração ficam com mensagens_reserva', () => {
  it('reaplica o ADD COLUMN/DROP DEFAULT da própria migração sobre uma linha legada (desfeito ao fim)', async () => {
    const sql = readFileSync(
      fileURLToPath(new URL('../../../prisma/migrations/20261121100000_consentimento_finalidade/migration.sql', import.meta.url)),
      'utf8',
    );
    const add = /ALTER TABLE "consentimento" ADD COLUMN "finalidade"[^;]*;/.exec(sql)?.[0];
    const drop = /ALTER TABLE "consentimento" ALTER COLUMN "finalidade" DROP DEFAULT;/.exec(sql)?.[0];
    expect(add).toBeDefined();
    expect(drop).toBeDefined();
    await c.query('BEGIN');
    try {
      await c.query('DROP INDEX consentimento_vigente_idx');
      await c.query('ALTER TABLE consentimento DROP COLUMN finalidade');
      await c.query("INSERT INTO consentimento (id, salao_id, cliente_id, origem, versao_termos) VALUES ('99999999-9999-4999-8999-999999999999', $1, $2, 'publico', 'v1')", [s.salaoId, clienteId]);
      await c.query(add!);
      await c.query(drop!);
      const { rows } = await c.query("SELECT finalidade::text AS f FROM consentimento WHERE id = '99999999-9999-4999-8999-999999999999'");
      expect(rows).toEqual([{ f: 'mensagens_reserva' }]);
    } finally {
      await c.query('ROLLBACK');
    }
    const { rows } = await c.query("SELECT 1 FROM information_schema.columns WHERE table_name = 'consentimento' AND column_name = 'finalidade'");
    expect(rows).toHaveLength(1);
  });
});
