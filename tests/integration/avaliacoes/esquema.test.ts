import { createHash, randomUUID } from 'node:crypto';

import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { conectar, criarCenario, erroSql, inserirReserva } from '../../support/sql';

// D-032 (E4.5), migração 20261122000000_avaliacao. Contrato em docs/demandas/D-032/dba.md.
let c: pg.Client;
beforeAll(async () => {
  c = await conectar();
});
afterAll(async () => {
  await c.end();
});

const hash = () => createHash('sha256').update(randomUUID()).digest('hex');

async function reservaConcluida(salaoId: string, profissionalId: string, clienteId: string, hora = 10) {
  const h = String(hora).padStart(2, '0');
  return inserirReserva(c, {
    salaoId, profissionalId, clienteId, status: 'concluido',
    inicio: `2026-03-01T${h}:00:00Z`, fim: `2026-03-01T${h}:30:00Z`,
  });
}

function avaliacao(salaoId: string, reservaId: string, clienteId: string, nota: number | string = 5, extra: Record<string, unknown> = {}) {
  const d = { comentario: 'Ótimo', nome_exibicao: 'Ana B.', versao_termos: '2026-11-21-provisorio', ...extra };
  return c.query(
    `INSERT INTO avaliacao (salao_id, reserva_id, cliente_id, nota, comentario, nome_exibicao, publicacao_aceita_em, versao_termos)
     VALUES ($1,$2,$3,$4,$5,$6, now(), $7) RETURNING id`,
    [salaoId, reservaId, clienteId, nota, d.comentario, d.nome_exibicao, d.versao_termos],
  );
}

function convite(salaoId: string, reservaId: string, h = hash(), expira = "now() + interval '30 days'") {
  return c.query(
    `INSERT INTO avaliacao_convite (salao_id, reserva_id, token_hash, expira_em) VALUES ($1,$2,$3, ${expira}) RETURNING id`,
    [salaoId, reservaId, h],
  );
}

describe('CHECKs e unicidades', () => {
  it('avaliação: nota 1..5, tamanhos, versão e uma por reserva', async () => {
    const { salaoId, profissionalId, clienteId } = await criarCenario(c);
    const r = await reservaConcluida(salaoId, profissionalId, clienteId);
    expect((await erroSql(avaliacao(salaoId, r, clienteId, 0))).constraint).toBe('avaliacao_nota_chk');
    expect((await erroSql(avaliacao(salaoId, r, clienteId, 6))).constraint).toBe('avaliacao_nota_chk');
    expect((await erroSql(avaliacao(salaoId, r, clienteId, 5, { comentario: 'x'.repeat(1001) }))).constraint).toBe('avaliacao_comentario_chk');
    expect((await erroSql(avaliacao(salaoId, r, clienteId, 5, { nome_exibicao: 'x'.repeat(101) }))).constraint).toBe('avaliacao_nome_exibicao_chk');
    expect((await erroSql(avaliacao(salaoId, r, clienteId, 5, { versao_termos: 'Com Espaço' }))).constraint).toBe('avaliacao_versao_termos_chk');
    await avaliacao(salaoId, r, clienteId, 5, { comentario: 'x'.repeat(1000) });
    expect((await erroSql(avaliacao(salaoId, r, clienteId, 4))).constraint).toBe('avaliacao_reserva_id_key');
    await avaliacao(salaoId, await reservaConcluida(salaoId, profissionalId, clienteId, 12), clienteId, 3, { comentario: null, nome_exibicao: null });
  });

  it('convite: hash de 64 caracteres, validade, único por reserva e por hash', async () => {
    const { salaoId, profissionalId, clienteId } = await criarCenario(c);
    const r = await reservaConcluida(salaoId, profissionalId, clienteId);
    expect((await erroSql(convite(salaoId, r, 'curto'))).constraint).toBe('avaliacao_convite_token_hash_chk');
    expect((await erroSql(convite(salaoId, r, hash(), "now() - interval '1 day'"))).constraint).toBe('avaliacao_convite_validade_chk');
    const h = hash();
    await convite(salaoId, r, h);
    expect((await erroSql(convite(salaoId, r))).constraint).toBe('avaliacao_convite_reserva_id_key');
    const r2 = await reservaConcluida(salaoId, profissionalId, clienteId, 12);
    expect((await erroSql(convite(salaoId, r2, h))).constraint).toBe('avaliacao_convite_token_hash_key');
    const g = await c.query(
      `INSERT INTO avaliacao_convite (salao_id, reserva_id, token_hash, expira_em) VALUES ($1,$2,$3,now()+interval '1 day')
       ON CONFLICT (reserva_id) DO NOTHING RETURNING id`, [salaoId, r, hash()]);
    expect(g.rowCount).toBe(0);
  });
});

describe('isolamento entre salões (FKs compostas) e RESTRICT', () => {
  it('reserva ou cliente de outro salão é recusado; reserva com avaliação não pode ser apagada', async () => {
    const a = await criarCenario(c);
    const b = await criarCenario(c);
    const ra = await reservaConcluida(a.salaoId, a.profissionalId, a.clienteId);
    expect((await erroSql(avaliacao(b.salaoId, ra, b.clienteId))).constraint).toBe('avaliacao_salao_id_reserva_id_fkey');
    expect((await erroSql(avaliacao(a.salaoId, ra, b.clienteId))).constraint).toBe('avaliacao_salao_id_cliente_id_fkey');
    expect((await erroSql(convite(b.salaoId, ra))).constraint).toBe('avaliacao_convite_salao_id_reserva_id_fkey');
    await avaliacao(a.salaoId, ra, a.clienteId);
    await convite(a.salaoId, ra);
    expect((await erroSql(c.query('DELETE FROM reserva WHERE id = $1', [ra]))).code).toBe('23503');
    expect((await erroSql(c.query('DELETE FROM cliente WHERE id = $1', [a.clienteId]))).code).toBe('23503');
  });
});

describe('leitura pública: plano com 50 mil avaliações em um salão', () => {
  it('lista paginada usa avaliacao_publica_idx e o agregado lê só o salão', async () => {
    const { salaoId, profissionalId, clienteId } = await criarCenario(c);
    await c.query(
      `INSERT INTO reserva (salao_id, profissional_id, cliente_id, inicio, fim, ocupado_ate, status, origem)
       SELECT $1, $2, $3, '2026-01-01T00:00:00Z'::timestamptz + g * interval '1 hour', '2026-01-01T00:00:00Z'::timestamptz + g * interval '1 hour' + interval '30 min',
              '2026-01-01T00:00:00Z'::timestamptz + g * interval '1 hour' + interval '30 min', 'concluido', 'publico'
       FROM generate_series(0, 49999) g`, [salaoId, profissionalId, clienteId],
    );
    await c.query(
      `INSERT INTO avaliacao (salao_id, reserva_id, cliente_id, nota, comentario, nome_exibicao, publicacao_aceita_em, versao_termos, criado_em)
       SELECT salao_id, id, cliente_id, 1 + (row_number() OVER ())::int % 5, 'c', 'N.', now(), 'v1', inicio FROM reserva WHERE salao_id = $1`, [salaoId]);
    await c.query('ANALYZE avaliacao');
    await c.query('ANALYZE reserva');
    const VIS = `a.retirada_em IS NULL AND r.status = 'concluido' AND c.anonimizada_em IS NULL`;
    const lista = `SELECT a.nome_exibicao, a.nota FROM avaliacao a JOIN reserva r ON r.salao_id=a.salao_id AND r.id=a.reserva_id
      JOIN cliente c ON c.salao_id=a.salao_id AND c.id=a.cliente_id WHERE a.salao_id='${salaoId}' AND ${VIS}
      ORDER BY a.criado_em DESC, a.id DESC LIMIT 10`;
    const plano = (await c.query(`EXPLAIN (ANALYZE, FORMAT TEXT) ${lista}`)).rows.map((x) => x['QUERY PLAN']).join('\n');
    console.info('[D-032] plano da lista\n' + plano);
    expect(plano).toContain('avaliacao_publica_idx');
    const t0 = Date.now();
    const agg = await c.query(
      `SELECT count(*)::int AS n, round(avg(a.nota)::numeric, 1) AS media FROM avaliacao a JOIN reserva r ON r.salao_id=a.salao_id AND r.id=a.reserva_id
       JOIN cliente c ON c.salao_id=a.salao_id AND c.id=a.cliente_id WHERE a.salao_id=$1 AND ${VIS}`, [salaoId]);
    console.info(`[D-032] agregado ms=${Date.now() - t0} n=${agg.rows[0].n} media=${agg.rows[0].media}`);
    expect(agg.rows[0].n).toBe(50000);
  }, 120_000);
});
