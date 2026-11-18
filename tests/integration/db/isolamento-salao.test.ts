import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  conectar,
  criarCenario,
  criarServico,
  erroSql,
  inserirReserva,
  type ErroSql,
} from '../support/sql';

// CA-9 (RN-2, CLAUDE.md "Tenant isolation"): FKs compostas (salao_id, x_id) rejeitam a
// referência a uma linha de outro salão com 23503.
let c: pg.Client;
let a: { salaoId: string; profissionalId: string; clienteId: string; servicoId: string; reservaId: string };
let b: { salaoId: string; profissionalId: string; clienteId: string; servicoId: string };

beforeAll(async () => {
  c = await conectar();
  const sa = await criarCenario(c);
  const reservaId = await inserirReserva(c, {
    ...sa,
    inicio: '2026-12-01T10:00:00Z',
    fim: '2026-12-01T11:00:00Z',
  });
  a = { ...sa, servicoId: await criarServico(c, sa.salaoId), reservaId };
  const sb = await criarCenario(c);
  b = { ...sb, servicoId: await criarServico(c, sb.salaoId) };
});

afterAll(async () => {
  await c.end();
});

async function contar(sql: string, params: unknown[]): Promise<number> {
  const r = await c.query<{ n: number }>(sql, params);
  return r.rows[0].n;
}

describe('FKs compostas entre salões', () => {
  it('CA-9: reserva do salão A com profissional do salão B é rejeitada (23503)', async () => {
    const erro = await erroSql(
      inserirReserva(c, {
        salaoId: a.salaoId,
        profissionalId: b.profissionalId,
        clienteId: a.clienteId,
        inicio: '2026-12-02T10:00:00Z',
        fim: '2026-12-02T11:00:00Z',
      }),
    );
    expect(erro).toEqual<ErroSql>({ code: '23503', constraint: 'reserva_salao_id_profissional_id_fkey' });
    expect(await contar('SELECT count(*)::int AS n FROM reserva WHERE profissional_id = $1', [b.profissionalId])).toBe(0);
  });

  it('CA-9: reserva do salão A com cliente do salão B é rejeitada (23503)', async () => {
    const erro = await erroSql(
      inserirReserva(c, {
        salaoId: a.salaoId,
        profissionalId: a.profissionalId,
        clienteId: b.clienteId,
        inicio: '2026-12-03T10:00:00Z',
        fim: '2026-12-03T11:00:00Z',
      }),
    );
    expect(erro).toEqual<ErroSql>({ code: '23503', constraint: 'reserva_salao_id_cliente_id_fkey' });
    expect(await contar('SELECT count(*)::int AS n FROM reserva WHERE cliente_id = $1', [b.clienteId])).toBe(0);
  });

  it('CA-9: item de reserva do salão A com serviço do salão B é rejeitado (23503)', async () => {
    const erro = await erroSql(
      c.query(
        `INSERT INTO reserva_item (salao_id, reserva_id, servico_id, ordem, preco_centavos, duracao_min)
         VALUES ($1, $2, $3, 1, 8000, 60)`,
        [a.salaoId, a.reservaId, b.servicoId],
      ),
    );
    expect(erro).toEqual<ErroSql>({ code: '23503', constraint: 'reserva_item_salao_id_servico_id_fkey' });
    expect(await contar('SELECT count(*)::int AS n FROM reserva_item WHERE reserva_id = $1', [a.reservaId])).toBe(0);
  });

  it('CA-9 (controle): item com serviço do próprio salão é aceito', async () => {
    await c.query(
      `INSERT INTO reserva_item (salao_id, reserva_id, servico_id, ordem, preco_centavos, duracao_min)
       VALUES ($1, $2, $3, 1, 8000, 60)`,
      [a.salaoId, a.reservaId, a.servicoId],
    );
    expect(await contar('SELECT count(*)::int AS n FROM reserva_item WHERE reserva_id = $1', [a.reservaId])).toBe(1);
  });

  it('CA-9: item do salão B apontando para reserva do salão A é rejeitado (23503)', async () => {
    const erro = await erroSql(
      c.query(
        `INSERT INTO reserva_item (salao_id, reserva_id, servico_id, ordem, preco_centavos, duracao_min)
         VALUES ($1, $2, $3, 1, 8000, 60)`,
        [b.salaoId, a.reservaId, b.servicoId],
      ),
    );
    expect(erro).toEqual<ErroSql>({ code: '23503', constraint: 'reserva_item_salao_id_reserva_id_fkey' });
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
        "INSERT INTO consentimento (salao_id, cliente_id, origem, versao_termos) VALUES ($1, $2, 'publico', 'v1')",
        [a.salaoId, b.clienteId],
      ),
    );
    expect(erro).toEqual<ErroSql>({ code: '23503', constraint: 'consentimento_salao_id_cliente_id_fkey' });
  });
});
