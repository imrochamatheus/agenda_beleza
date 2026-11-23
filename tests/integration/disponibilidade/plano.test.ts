import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Prisma } from '@/generated/prisma/client';
import { COLUNAS_FUNCIONAMENTO } from '@/server/repos/funcionamento';
import { consultaOcupacoes } from '@/server/repos/disponibilidade';

import { conectar } from '../../support/sql';

import { criarCenario, inserirProfissional, inserirCliente } from './apoio';
import type { Cenario } from './apoio';

// D-018 T-3 (CA-25), reescrito na D-050 T-3 (CA-3, dba.md Q6): plano da consulta de ocupação sobre
// `reserva_item` com volume (2 salões × 10 profissionais × 5.000 itens = 100.000 itens, em reservas de
// 2 itens com profissionais diferentes) e do `lerRegras` com COLUNAS_FUNCIONAMENTO. O plano é impresso
// com o prefixo [CA-3] (evidência de dev.md). Sem DROP INDEX nem enable_seqscan = off: só ANALYZE.

let c: pg.Client;
let sal: { cenario: Cenario; profissionais: string[]; cliente: string }[];

const BASE = '2026-06-01T00:00:00Z';
// Consulta de 61 dias dentro do intervalo coberto (~4 anos): ~188 reservas por profissional (~4%).
const PERIODO_LONGO = { de: new Date('2028-01-01T00:00:00Z'), ate: new Date('2028-03-02T00:00:00Z') };
const PERIODO_CURTO = { de: new Date('2028-01-01T00:00:00Z'), ate: new Date('2028-01-02T00:00:00Z') };

beforeAll(async () => {
  c = await conectar();
  sal = [];
  for (let i = 0; i < 2; i++) {
    const cenario = await criarCenario(c);
    const profissionais = [cenario.ana, cenario.bia];
    for (let k = 3; k <= 10; k++) profissionais.push(await inserirProfissional(c, cenario.s.salaoId, `Prof ${k}`));
    const cliente = await inserirCliente(c, cenario.s.salaoId);
    // Um item de 30 min a cada 7 h por profissional (sem sobreposição), 10% cancelados. Cada reserva tem
    // 2 itens em sequência: o do profissional k (0..4) e, logo depois, o do profissional k + 5 (A e B).
    // Os derivados da reserva não importam aqui (só reserva_item é lido).
    const BASE_SQL = `
      SELECT md5($1::text || ':' || k || ':' || g)::uuid AS rid, k, g, $2::timestamptz + g * interval '7 hours' AS t,
             (CASE WHEN g % 10 = 0 THEN 'cancelado'
                   WHEN g % 3 = 0 THEN 'concluido'
                   WHEN g % 3 = 1 THEN 'confirmado'
                   ELSE 'nao_compareceu' END)::status_reserva AS st
        FROM generate_series(0, 4) AS k CROSS JOIN generate_series(0, 4999) AS g`;
    await c.query(
      `INSERT INTO reserva (id, salao_id, cliente_id, inicio, fim, status, origem, cancelada_em)
       SELECT b.rid, $1::uuid, $3::uuid, b.t, b.t + interval '60 minutes', b.st, 'equipe',
              CASE WHEN b.st = 'cancelado' THEN b.t END
         FROM (${BASE_SQL}) b`,
      [cenario.s.salaoId, BASE, cliente],
    );
    await c.query(
      `INSERT INTO reserva_item (salao_id, reserva_id, servico_id, profissional_id, ordem, preco_centavos, duracao_min,
                                 inicio, fim, ocupado_ate, status)
       SELECT $1::uuid, b.rid, x.servico, ($3::uuid[])[x.p + 1], x.ordem, 5000, 30, x.t, x.t + interval '30 minutes',
              x.t + interval '30 minutes', b.st
         FROM (${BASE_SQL}) b
         CROSS JOIN LATERAL (VALUES (b.k, $4::uuid, 0, b.t), (b.k + 5, $5::uuid, 1, b.t + interval '30 minutes'))
           AS x(p, servico, ordem, t)`,
      [cenario.s.salaoId, BASE, profissionais, cenario.A, cenario.B],
    );
    sal.push({ cenario, profissionais, cliente });
  }
  await c.query('ANALYZE reserva; ANALYZE reserva_item');
}, 120_000);

afterAll(async () => {
  await c.end();
});

type Linha = { 'QUERY PLAN': string };
const texto = (rows: Linha[]) => rows.map((l) => l['QUERY PLAN']).join('\n');

async function planoCustom(sql: Prisma.Sql): Promise<string> {
  const { rows } = await c.query<Linha>(`EXPLAIN (ANALYZE, BUFFERS) ${sql.text}`, sql.values as unknown[]);
  return texto(rows);
}

/** Plano genérico: PREPARE + plan_cache_mode = force_generic_plan (os parâmetros não são conhecidos). */
async function planoGenerico(sql: Prisma.Sql): Promise<string> {
  await c.query('BEGIN');
  try {
    await c.query('SET LOCAL plan_cache_mode = force_generic_plan');
    await c.query(`PREPARE plano_ocupacao AS ${sql.text}`);
    const args = sql.values
      .map((v) => {
        if (v instanceof Date) return c.escapeLiteral(v.toISOString());
        if (Array.isArray(v)) return c.escapeLiteral(`{${v.join(',')}}`);
        return c.escapeLiteral(String(v));
      })
      .join(', ');
    const { rows } = await c.query<Linha>(`EXPLAIN (ANALYZE, BUFFERS) EXECUTE plano_ocupacao(${args})`);
    return texto(rows);
  } finally {
    await c.query('ROLLBACK');
    await c.query('DEALLOCATE ALL');
  }
}

const SEM_SEQ = /Seq Scan on reserva_item\b/;
const COM_INDICE = /(Index Scan|Bitmap Index Scan)( using| on) reserva_item_sem_sobreposicao/;
const tempo = (plano: string) => /Execution Time: ([\d.]+) ms/.exec(plano)?.[1];

describe('CA-3: plano da consulta de ocupação sobre reserva_item com volume', () => {
  it('o volume foi carregado (2 × 10 × 5.000 itens, em 50.000 reservas de 2 itens)', async () => {
    const { rows: reservas } = await c.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM reserva WHERE salao_id = ANY($1::uuid[])',
      [sal.map((x) => x.cenario.s.salaoId)],
    );
    expect(reservas[0].n).toBe(50_000);
    const { rows } = await c.query<{ n: number; ativas: number }>(
      `SELECT count(*)::int AS n, count(*) FILTER (WHERE status <> 'cancelado')::int AS ativas FROM reserva_item WHERE salao_id = ANY($1::uuid[])`,
      [sal.map((x) => x.cenario.s.salaoId)],
    );
    expect(rows[0].n).toBe(100_000);
    expect(rows[0].ativas).toBe(90_000);
  });

  it('o texto mantém o literal de status e a expressão da constraint', () => {
    const q = consultaOcupacoes(sal[0].cenario.s.salaoId, sal[0].profissionais, PERIODO_LONGO);
    expect(q.text).toContain("i.status IN ('confirmado', 'concluido', 'nao_compareceu')");
    expect(q.text).toContain("tstzrange(i.inicio, i.ocupado_ate, '[)')");
    expect(q.text).toMatch(/FROM reserva_item i\b/);
    expect(q.text).not.toMatch(/FROM reserva\b(?!_)/);
    expect(q.text).not.toMatch(/telefone|cliente_id/i);
  });

  it.each([
    ['10 profissionais × 61 dias', PERIODO_LONGO, 10],
    ['1 profissional × 1 dia', PERIODO_CURTO, 1],
  ])('plano custom (%s): índice reserva_item_sem_sobreposicao e nenhum Seq Scan em reserva_item', async (nome, periodo, n) => {
    const { cenario, profissionais } = sal[0];
    const sql = consultaOcupacoes(cenario.s.salaoId, profissionais.slice(0, n), periodo);
    const plano = await planoCustom(sql);
    console.log(`[CA-3] custom ${nome} (ms=${tempo(plano)})\n${plano}`);
    expect(plano).not.toMatch(SEM_SEQ);
    expect(plano).toMatch(COM_INDICE);
  }, 60_000);

  it.each([
    ['10 profissionais × 61 dias', PERIODO_LONGO, 10],
    ['1 profissional × 1 dia', PERIODO_CURTO, 1],
  ])('plano genérico (%s): índice reserva_item_sem_sobreposicao e nenhum Seq Scan em reserva_item', async (nome, periodo, n) => {
    const { cenario, profissionais } = sal[1];
    const sql = consultaOcupacoes(cenario.s.salaoId, profissionais.slice(0, n), periodo);
    const plano = await planoGenerico(sql);
    console.log(`[CA-3] genérico ${nome} (ms=${tempo(plano)})\n${plano}`);
    expect(plano).toContain('$');
    expect(plano).not.toMatch(SEM_SEQ);
    expect(plano).toMatch(COM_INDICE);
  }, 60_000);

  it('devolve as ocupações esperadas no volume (nada de cancelada, só do salão)', async () => {
    const { cenario, profissionais } = sal[0];
    const sql = consultaOcupacoes(cenario.s.salaoId, profissionais, PERIODO_LONGO);
    const { rows } = await c.query<{ profissional_id: string; inicio: Date }>(sql.text, sql.values as unknown[]);
    // ~1464 h / 7 h ≈ 209 itens por profissional; 10% cancelados.
    expect(rows.length).toBeGreaterThan(1500);
    expect(rows.length).toBeLessThan(2100);
    expect(new Set(rows.map((r) => r.profissional_id))).toEqual(new Set(profissionais));
    const { rows: canceladas } = await c.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM reserva_item WHERE salao_id = $1 AND status = 'cancelado'
        AND tstzrange(inicio, ocupado_ate, '[)') && tstzrange($2::timestamptz, $3::timestamptz, '[)')`,
      [cenario.s.salaoId, PERIODO_LONGO.de, PERIODO_LONGO.ate],
    );
    expect(canceladas[0].n).toBeGreaterThan(0);
  });
});

describe('plano do lerRegras com COLUNAS_FUNCIONAMENTO (dba.md, pendência 6)', () => {
  let definido: string;
  let naoDefinido: string;

  beforeAll(async () => {
    // 1.000 salões de carga, metade com funcionamento informado (14 intervalos cada).
    await c.query(`INSERT INTO salao (nome, funcionamento_definido) SELECT 'Carga ' || g, (g % 2 = 0) FROM generate_series(1, 1000) g`);
    await c.query(
      `INSERT INTO salao_funcionamento (salao_id, dia_semana, inicio_min, fim_min)
       SELECT s.id, d, h.i, h.f FROM salao s CROSS JOIN generate_series(0, 6) d
        CROSS JOIN (VALUES (540, 720), (780, 1080)) AS h(i, f)
        WHERE s.nome LIKE 'Carga %' AND s.funcionamento_definido`,
    );
    await c.query('ANALYZE salao; ANALYZE salao_funcionamento');
    definido = (await c.query<{ id: string }>(`SELECT id::text AS id FROM salao WHERE nome LIKE 'Carga %' AND funcionamento_definido LIMIT 1`)).rows[0].id;
    naoDefinido = (await c.query<{ id: string }>(`SELECT id::text AS id FROM salao WHERE nome LIKE 'Carga %' AND NOT funcionamento_definido LIMIT 1`)).rows[0].id;
  }, 60_000);

  const regras = (id: string) => Prisma.sql`
    SELECT s.fuso, s.grade_min, s.antecedencia_min, s.janela_dias, s.intervalo_min, ${COLUNAS_FUNCIONAMENTO}
      FROM salao s
     WHERE s.id = ${id}::uuid`;

  it('funcionamento informado: acessa salao por salao_pkey e salao_funcionamento por salao_id', async () => {
    const plano = await planoCustom(regras(definido));
    console.log(`[CA-3] lerRegras (funcionamento informado)\n${plano}`);
    expect(plano).toMatch(/Index Scan using salao_pkey on salao s/);
    expect(plano).toMatch(/salao_funcionamento_sem_sobreposicao/);
    expect(plano).not.toMatch(/Seq Scan on salao_funcionamento/);
    expect(plano).not.toMatch(/never executed/);
  }, 60_000);

  it('não informado: a subconsulta de salao_funcionamento não executa (never executed)', async () => {
    const plano = await planoCustom(regras(naoDefinido));
    console.log(`[CA-3] lerRegras (não informado)\n${plano}`);
    expect(plano).toMatch(/Index Scan using salao_pkey on salao s/);
    expect(plano).toMatch(/salao_funcionamento[^\n]*\(never executed\)/);
  }, 60_000);
});
