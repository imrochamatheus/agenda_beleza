import { randomUUID } from 'node:crypto';

import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { conectar, criarCenario, erroSql, inserirReserva } from '../../support/sql';

// D-035 (E8.4), migração 20261124000000_avaliacao_denuncia. Contrato em docs/demandas/D-035/dba.md.
let c: pg.Client;
beforeAll(async () => {
  c = await conectar();
});
afterAll(async () => {
  await c.end();
});

async function avaliacaoDe(cenario: { salaoId: string; profissionalId: string; clienteId: string }, hora = 10) {
  const h = String(hora).padStart(2, '0');
  const r = await inserirReserva(c, {
    salaoId: cenario.salaoId, profissionalId: cenario.profissionalId, clienteId: cenario.clienteId,
    status: 'concluido', inicio: `2026-03-01T${h}:00:00Z`, fim: `2026-03-01T${h}:30:00Z`,
  });
  const a = await c.query(
    `INSERT INTO avaliacao (salao_id, reserva_id, cliente_id, nota, publicacao_aceita_em, versao_termos)
     VALUES ($1,$2,$3,5, now(), 'v1') RETURNING id`,
    [cenario.salaoId, r, cenario.clienteId],
  );
  return a.rows[0].id as string;
}

function denuncia(salaoId: string, avaliacaoId: string, ip = 'a'.repeat(64), extra: Record<string, unknown> = {}) {
  const d = { motivo: 'spam', texto: null, ...extra };
  return c.query(
    `INSERT INTO avaliacao_denuncia (salao_id, avaliacao_id, motivo, texto, ip_hash) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [salaoId, avaliacaoId, d.motivo, d.texto, ip],
  );
}

describe('CHECKs, enum e estado', () => {
  it('motivo fechado, texto <= 500 sem vazio/espaços, ip_hash e estado x resolucao', async () => {
    const cen = await criarCenario(c);
    const av = await avaliacaoDe(cen);
    expect((await erroSql(denuncia(cen.salaoId, av, 'b'.repeat(64), { motivo: 'xyz' }))).code).toBe('22P02');
    expect((await erroSql(denuncia(cen.salaoId, av, 'b'.repeat(64), { texto: 'x'.repeat(501) }))).constraint).toBe('avaliacao_denuncia_texto_chk');
    expect((await erroSql(denuncia(cen.salaoId, av, 'b'.repeat(64), { texto: '' }))).constraint).toBe('avaliacao_denuncia_texto_chk');
    expect((await erroSql(denuncia(cen.salaoId, av, 'b'.repeat(64), { texto: ' x ' }))).constraint).toBe('avaliacao_denuncia_texto_chk');
    expect((await erroSql(denuncia(cen.salaoId, av, 'curto'))).constraint).toBe('avaliacao_denuncia_ip_hash_chk');
    const ok = await denuncia(cen.salaoId, av, 'c'.repeat(64), { texto: 'x'.repeat(500) });
    const id = ok.rows[0].id;
    const upd = (set: string) => c.query(`UPDATE avaliacao_denuncia SET ${set} WHERE id = $1`, [id]);
    expect((await erroSql(upd("resolvida_em = now()"))).constraint).toBe('avaliacao_denuncia_estado_chk');
    expect((await erroSql(upd("resolucao = 'mantida'"))).constraint).toBe('avaliacao_denuncia_estado_chk');
    expect((await erroSql(upd(`resolvida_em = now(), resolucao = 'outra', resolvida_por = '${randomUUID()}'`))).constraint).toBe('avaliacao_denuncia_resolucao_chk');
    expect((await upd(`resolvida_em = now(), resolucao = 'retirada', resolvida_por = '${randomUUID()}'`)).rowCount).toBe(1);
  });
});

describe('dedupe parcial (avaliacao_id, ip_hash) enquanto pendente', () => {
  it('segunda pendente do mesmo IP não entra; ON CONFLICT DO NOTHING é silencioso; resolvida libera nova', async () => {
    const cen = await criarCenario(c);
    const av = await avaliacaoDe(cen);
    const ip = 'd'.repeat(64);
    const a = await denuncia(cen.salaoId, av, ip);
    expect((await erroSql(denuncia(cen.salaoId, av, ip))).constraint).toBe('avaliacao_denuncia_pendente_uniq');
    const dn = await c.query(
      `INSERT INTO avaliacao_denuncia (salao_id, avaliacao_id, motivo, ip_hash) VALUES ($1,$2,'spam',$3)
       ON CONFLICT (avaliacao_id, ip_hash) WHERE resolvida_em IS NULL DO NOTHING RETURNING id`,
      [cen.salaoId, av, ip],
    );
    expect(dn.rowCount).toBe(0);
    await denuncia(cen.salaoId, av, 'e'.repeat(64));
    await c.query(`UPDATE avaliacao_denuncia SET resolvida_em = now(), resolucao = 'mantida', resolvida_por = $2 WHERE id = $1`, [a.rows[0].id, randomUUID()]);
    await denuncia(cen.salaoId, av, ip);
  });

  it('10 inserções concorrentes do mesmo IP gravam exatamente uma', async () => {
    const cen = await criarCenario(c);
    const av = await avaliacaoDe(cen);
    const clientes = await Promise.all(Array.from({ length: 10 }, () => conectar()));
    try {
      const rs = await Promise.all(clientes.map((k) => k.query(
        `INSERT INTO avaliacao_denuncia (salao_id, avaliacao_id, motivo, ip_hash) VALUES ($1,$2,'outro',$3)
         ON CONFLICT (avaliacao_id, ip_hash) WHERE resolvida_em IS NULL DO NOTHING RETURNING id`,
        [cen.salaoId, av, 'f'.repeat(64)],
      )));
      expect(rs.reduce((n, r) => n + (r.rowCount ?? 0), 0)).toBe(1);
    } finally {
      await Promise.all(clientes.map((k) => k.end()));
    }
  });
});

describe('isolamento entre salões e RESTRICT', () => {
  it('avaliação de outro salão é recusada; avaliação com denúncia não pode ser apagada', async () => {
    const a = await criarCenario(c);
    const b = await criarCenario(c);
    const av = await avaliacaoDe(a);
    expect((await erroSql(denuncia(b.salaoId, av))).constraint).toBe('avaliacao_denuncia_salao_id_avaliacao_id_fkey');
    await denuncia(a.salaoId, av);
    expect((await erroSql(c.query('DELETE FROM avaliacao WHERE id = $1', [av]))).code).toBe('23503');
    expect((await erroSql(c.query('DELETE FROM salao WHERE id = $1', [a.salaoId]))).code).toBe('23503');
  });

  it('auditoria aceita a nova ação e a nova entidade (sem CHECK em acao/entidade)', async () => {
    const r = await c.query(
      `SELECT count(*)::int AS n FROM pg_constraint WHERE conrelid = 'auditoria'::regclass AND contype = 'c'`,
    );
    expect(r.rows[0].n).toBe(0);
    const ins = await c.query(
      `INSERT INTO auditoria (acao, entidade, entidade_id, resultado) VALUES ('avaliacao.denuncia_resolver','avaliacao_denuncia',$1,'sucesso') RETURNING id`,
      [randomUUID()],
    );
    expect(ins.rowCount).toBe(1);
  });
});

describe('fila de moderação: plano com 50 mil denúncias', () => {
  it('pendentes (global e por salão) usam os índices parciais; resolvidas não pesam', async () => {
    const cen = await criarCenario(c);
    const av = await avaliacaoDe(cen);
    await c.query(
      `INSERT INTO avaliacao_denuncia (salao_id, avaliacao_id, motivo, ip_hash, criado_em, resolvida_em, resolucao, resolvida_por)
       SELECT $1, $2, 'spam', md5(g::text) || md5(g::text), '2026-01-01T00:00:00Z'::timestamptz + g * interval '1 minute',
              CASE WHEN g % 100 <> 0 THEN now() END, CASE WHEN g % 100 <> 0 THEN 'mantida' END, CASE WHEN g % 100 <> 0 THEN $3::uuid END
       FROM generate_series(1, 50000) g`,
      [cen.salaoId, av, randomUUID()],
    );
    await c.query('ANALYZE avaliacao_denuncia');
    const explicar = async (sql: string, params: unknown[]) =>
      (await c.query(`EXPLAIN (ANALYZE, FORMAT TEXT) ${sql}`, params)).rows.map((x) => x['QUERY PLAN']).join('\n');
    const global = await explicar(
      `SELECT id FROM avaliacao_denuncia WHERE resolvida_em IS NULL ORDER BY criado_em DESC, id DESC LIMIT 20`, []);
    const porSalao = await explicar(
      `SELECT id FROM avaliacao_denuncia WHERE salao_id = $1 AND resolvida_em IS NULL ORDER BY criado_em DESC, id DESC LIMIT 20`, [cen.salaoId]);
    const contagem = await explicar(
      `SELECT count(*) FROM avaliacao_denuncia WHERE avaliacao_id = $1 AND resolvida_em IS NULL`, [av]);
    console.info('[D-035] fila global\n' + global + '\n[D-035] fila por salão\n' + porSalao + '\n[D-035] contagem de pendentes\n' + contagem);
    expect(global).toContain('avaliacao_denuncia_fila_global_idx');
    expect(porSalao).toMatch(/avaliacao_denuncia_fila(_global)?_idx/);
    expect(contagem).toMatch(/avaliacao_denuncia_(avaliacao_pendente_idx|pendente_uniq)/);
  }, 120_000);
});
