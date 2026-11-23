import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { conectar, criarCenario, criarServico, erroSql, type ErroSql } from '../../support/sql';

// CA-9 (RN-2, CLAUDE.md "Tenant isolation"): FKs compostas (salao_id, x_id) rejeitam a
// referência a uma linha de outro salão com 23503. D-050 (CA-50): o profissional é do ITEM
// (reserva_item_salao_id_profissional_id_fkey) e a mensagem pode citar um item da MESMA reserva.
let c: pg.Client;
let a: { salaoId: string; profissionalId: string; clienteId: string; servicoId: string; reservaId: string };
let b: { salaoId: string; profissionalId: string; clienteId: string; servicoId: string; reservaId: string; itemId: string };

// Helpers locais (D-050): `tests/support/sql.ts` é da T-2 e ainda grava o modelo antigo.
async function inserirReserva(salaoId: string, clienteId: string, inicio = '2026-12-01T10:00:00Z'): Promise<string> {
  const r = await c.query<{ id: string }>(
    `INSERT INTO reserva (salao_id, cliente_id, inicio, fim, status, origem)
     VALUES ($1, $2, $3::timestamptz, $3::timestamptz + interval '60 minutes', 'confirmado', 'publico') RETURNING id`,
    [salaoId, clienteId, inicio],
  );
  return r.rows[0].id;
}

function inserirItem(
  salaoId: string,
  reservaId: string,
  servicoId: string,
  profissionalId: string,
  inicio = '2026-12-01T10:00:00Z',
  ordem = 0,
) {
  return c.query<{ id: string }>(
    `INSERT INTO reserva_item (salao_id, reserva_id, servico_id, profissional_id, ordem, preco_centavos, duracao_min,
                               inicio, fim, ocupado_ate, status)
     VALUES ($1, $2, $3, $4, $6, 8000, 60, $5::timestamptz, $5::timestamptz + interval '60 minutes',
             $5::timestamptz + interval '60 minutes', 'confirmado') RETURNING id`,
    [salaoId, reservaId, servicoId, profissionalId, inicio, ordem],
  );
}

beforeAll(async () => {
  c = await conectar();
  const sa = await criarCenario(c);
  a = { ...sa, servicoId: await criarServico(c, sa.salaoId), reservaId: await inserirReserva(sa.salaoId, sa.clienteId) };
  const sb = await criarCenario(c);
  const servicoB = await criarServico(c, sb.salaoId);
  const reservaB = await inserirReserva(sb.salaoId, sb.clienteId);
  const itemB = (await inserirItem(sb.salaoId, reservaB, servicoB, sb.profissionalId)).rows[0].id;
  b = { ...sb, servicoId: servicoB, reservaId: reservaB, itemId: itemB };
});

afterAll(async () => {
  await c.end();
});

async function contar(sql: string, params: unknown[]): Promise<number> {
  const r = await c.query<{ n: number }>(sql, params);
  return r.rows[0].n;
}

describe('FKs compostas entre salões', () => {
  it('CA-9/CA-50 (D-050): item do salão A com profissional do salão B é rejeitado (23503)', async () => {
    const erro = await erroSql(inserirItem(a.salaoId, a.reservaId, a.servicoId, b.profissionalId, '2026-12-02T10:00:00Z'));
    expect(erro).toEqual<ErroSql>({ code: '23503', constraint: 'reserva_item_salao_id_profissional_id_fkey' });
    expect(await contar('SELECT count(*)::int AS n FROM reserva_item WHERE profissional_id = $1', [b.profissionalId])).toBe(1);
  });

  it('CA-9: reserva do salão A com cliente do salão B é rejeitada (23503)', async () => {
    const erro = await erroSql(inserirReserva(a.salaoId, b.clienteId, '2026-12-03T10:00:00Z'));
    expect(erro).toEqual<ErroSql>({ code: '23503', constraint: 'reserva_salao_id_cliente_id_fkey' });
    expect(await contar('SELECT count(*)::int AS n FROM reserva WHERE cliente_id = $1', [b.clienteId])).toBe(1);
  });

  it('CA-9: item de reserva do salão A com serviço do salão B é rejeitado (23503)', async () => {
    const erro = await erroSql(inserirItem(a.salaoId, a.reservaId, b.servicoId, a.profissionalId));
    expect(erro).toEqual<ErroSql>({ code: '23503', constraint: 'reserva_item_salao_id_servico_id_fkey' });
    expect(await contar('SELECT count(*)::int AS n FROM reserva_item WHERE reserva_id = $1', [a.reservaId])).toBe(0);
  });

  it('CA-9 (controle): item com serviço e profissional do próprio salão é aceito', async () => {
    await inserirItem(a.salaoId, a.reservaId, a.servicoId, a.profissionalId);
    expect(await contar('SELECT count(*)::int AS n FROM reserva_item WHERE reserva_id = $1', [a.reservaId])).toBe(1);
  });

  it('CA-9: item do salão B apontando para reserva do salão A é rejeitado (23503)', async () => {
    const erro = await erroSql(inserirItem(b.salaoId, a.reservaId, b.servicoId, b.profissionalId, '2026-12-04T10:00:00Z'));
    expect(erro).toEqual<ErroSql>({ code: '23503', constraint: 'reserva_item_salao_id_reserva_id_fkey' });
  });

  it('CA-50 (D-050): mensagem do salão A citando item de reserva do salão B é rejeitada (23503)', async () => {
    const erro = await erroSql(
      c.query(
        "INSERT INTO mensagem (salao_id, reserva_id, reserva_item_id, tipo, revisao) VALUES ($1, $2, $3, 'cancelamento', 1)",
        [a.salaoId, a.reservaId, b.itemId],
      ),
    );
    expect(erro).toEqual<ErroSql>({ code: '23503', constraint: 'mensagem_salao_id_reserva_id_reserva_item_id_fkey' });
  });

  it('D-050: mensagem citando item de OUTRA reserva do mesmo salão é rejeitada (23503)', async () => {
    const outra = await inserirReserva(a.salaoId, a.clienteId, '2026-12-06T10:00:00Z');
    const servico = await criarServico(c, a.salaoId);
    const item = (await inserirItem(a.salaoId, outra, servico, a.profissionalId, '2026-12-06T10:00:00Z')).rows[0].id;
    const erro = await erroSql(
      c.query(
        "INSERT INTO mensagem (salao_id, reserva_id, reserva_item_id, tipo, revisao) VALUES ($1, $2, $3, 'remarcacao', 1)",
        [a.salaoId, a.reservaId, item],
      ),
    );
    expect(erro).toEqual<ErroSql>({ code: '23503', constraint: 'mensagem_salao_id_reserva_id_reserva_item_id_fkey' });
    // Controle: o item da própria reserva é aceito.
    await c.query(
      "INSERT INTO mensagem (salao_id, reserva_id, reserva_item_id, tipo, revisao) VALUES ($1, $2, $3, 'remarcacao', 1)",
      [a.salaoId, outra, item],
    );
    expect(await contar('SELECT count(*)::int AS n FROM mensagem WHERE reserva_item_id = $1', [item])).toBe(1);
  });

  it('CA-9: bloqueio do salão A com profissional do salão B é rejeitado; sem profissional é aceito', async () => {
    const erro = await erroSql(
      c.query('INSERT INTO bloqueio (salao_id, profissional_id, inicio, fim) VALUES ($1, $2, $3, $4)', [
        a.salaoId,
        b.profissionalId,
        '2026-12-05T10:00:00Z',
        '2026-12-05T12:00:00Z',
      ]),
    );
    expect(erro).toEqual<ErroSql>({ code: '23503', constraint: 'bloqueio_salao_id_profissional_id_fkey' });

    // profissional_id nulo = salão inteiro; MATCH SIMPLE não verifica a FK composta.
    await c.query('INSERT INTO bloqueio (salao_id, inicio, fim) VALUES ($1, $2, $3)', [
      a.salaoId,
      '2026-12-05T10:00:00Z',
      '2026-12-05T12:00:00Z',
    ]);
    expect(
      await contar('SELECT count(*)::int AS n FROM bloqueio WHERE salao_id = $1 AND profissional_id IS NULL', [
        a.salaoId,
      ]),
    ).toBe(1);
  });

  it('CA-9: jornada do salão A com profissional do salão B é rejeitada (23503)', async () => {
    const erro = await erroSql(
      c.query(
        'INSERT INTO jornada (salao_id, profissional_id, dia_semana, inicio_min, fim_min) VALUES ($1, $2, 1, 540, 720)',
        [a.salaoId, b.profissionalId],
      ),
    );
    expect(erro).toEqual<ErroSql>({ code: '23503', constraint: 'jornada_salao_id_profissional_id_fkey' });
  });

  it('CA-9: servico_profissional cruzando salões é rejeitado nos dois lados (23503)', async () => {
    const lado1 = await erroSql(
      c.query('INSERT INTO servico_profissional (salao_id, servico_id, profissional_id) VALUES ($1, $2, $3)', [
        a.salaoId,
        b.servicoId,
        a.profissionalId,
      ]),
    );
    expect(lado1).toEqual<ErroSql>({ code: '23503', constraint: 'servico_profissional_salao_id_servico_id_fkey' });
    const lado2 = await erroSql(
      c.query('INSERT INTO servico_profissional (salao_id, servico_id, profissional_id) VALUES ($1, $2, $3)', [
        a.salaoId,
        a.servicoId,
        b.profissionalId,
      ]),
    );
    expect(lado2).toEqual<ErroSql>({
      code: '23503',
      constraint: 'servico_profissional_salao_id_profissional_id_fkey',
    });
  });

  it('CA-9: mensagem do salão B para reserva do salão A é rejeitada (23503)', async () => {
    const erro = await erroSql(
      c.query("INSERT INTO mensagem (salao_id, reserva_id, tipo, revisao) VALUES ($1, $2, 'confirmacao', 0)", [
        b.salaoId,
        a.reservaId,
      ]),
    );
    expect(erro).toEqual<ErroSql>({ code: '23503', constraint: 'mensagem_salao_id_reserva_id_fkey' });
  });

  it('CA-9: consentimento do salão A para cliente do salão B é rejeitado (23503)', async () => {
    const erro = await erroSql(
      c.query(
        "INSERT INTO consentimento (salao_id, cliente_id, finalidade, origem, versao_termos) VALUES ($1, $2, 'mensagens_reserva', 'publico', 'v1')",
        [a.salaoId, b.clienteId],
      ),
    );
    expect(erro).toEqual<ErroSql>({ code: '23503', constraint: 'consentimento_salao_id_cliente_id_fkey' });
  });
});
