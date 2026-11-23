import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { conectar, criarCenario, criarProfissional, criarSalao, criarServico, erroSql } from '../../support/sql';

// CA-20 (RN-4, RN-5) e os defaults de configuração do salão (spec §3 item 2).
let c: pg.Client;

beforeAll(async () => {
  c = await conectar();
});

afterAll(async () => {
  await c.end();
});

describe('defaults e snapshot', () => {
  it('CA-20: profissional e serviço inseridos sem ativo ficam ativo = true', async () => {
    const s = await criarSalao(c);
    const p = await criarProfissional(c, s);
    const sv = await criarServico(c, s);
    const rp = await c.query('SELECT ativo FROM profissional WHERE id = $1', [p]);
    const rs = await c.query('SELECT ativo FROM servico WHERE id = $1', [sv]);
    expect(rp.rows).toEqual([{ ativo: true }]);
    expect(rs.rows).toEqual([{ ativo: true }]);
  });

  it('CA-20 (spec §3.2): o salão recebe os defaults de configuração no banco', async () => {
    const s = await criarSalao(c);
    const r = await c.query(
      'SELECT fuso, grade_min, antecedencia_min, janela_dias, intervalo_min, suspenso_manual_em FROM salao WHERE id = $1',
      [s],
    );
    expect(r.rows).toEqual([
      {
        fuso: 'America/Sao_Paulo',
        grade_min: 15,
        antecedencia_min: 120,
        janela_dias: 60,
        intervalo_min: 0,
        suspenso_manual_em: null,
      },
    ]);
  });

  it('CA-20 (spec §3.2; D-050): a reserva nasce confirmada, com revisao 0 (sem profissional, ocupado_ate nem encaixe)', async () => {
    const s = await criarCenario(c);
    const id = await c.query<{ id: string }>(
      `INSERT INTO reserva (salao_id, cliente_id, inicio, fim, origem)
       VALUES ($1, $2, '2026-12-01T10:00:00Z', '2026-12-01T11:00:00Z', 'equipe') RETURNING id`,
      [s.salaoId, s.clienteId],
    );
    const r = await c.query('SELECT status, revisao, cancelada_em FROM reserva WHERE id = $1', [id.rows[0].id]);
    expect(r.rows).toEqual([{ status: 'confirmado', revisao: 0, cancelada_em: null }]);
  });

  describe('reserva_item (snapshot)', () => {
    async function itemCom(preco: number, duracao: number) {
      const s = await criarCenario(c);
      const reserva = await c.query<{ id: string }>(
        `INSERT INTO reserva (salao_id, cliente_id, inicio, fim, origem)
         VALUES ($1, $2, '2026-12-01T10:00:00Z', '2026-12-01T11:00:00Z', 'publico') RETURNING id`,
        [s.salaoId, s.clienteId],
      );
      const reservaId = reserva.rows[0].id;
      const servicoId = await criarServico(c, s.salaoId);
      return {
        reservaId,
        s,
        inserir: (status: string | null = 'confirmado') =>
          c.query(
            status === null
              ? `INSERT INTO reserva_item (salao_id, reserva_id, servico_id, profissional_id, ordem, preco_centavos,
                                           duracao_min, inicio, fim, ocupado_ate)
                 VALUES ($1, $2, $3, $4, 1, $5, $6, '2026-12-01T10:00:00Z',
                         '2026-12-01T10:00:00Z'::timestamptz + make_interval(mins => $6::int),
                         '2026-12-01T10:00:00Z'::timestamptz + make_interval(mins => $6::int))`
              : `INSERT INTO reserva_item (salao_id, reserva_id, servico_id, profissional_id, ordem, preco_centavos,
                                           duracao_min, inicio, fim, ocupado_ate, status)
                 VALUES ($1, $2, $3, $4, 1, $5, $6, '2026-12-01T10:00:00Z',
                         '2026-12-01T10:00:00Z'::timestamptz + make_interval(mins => GREATEST($6::int, 1)),
                         '2026-12-01T10:00:00Z'::timestamptz + make_interval(mins => GREATEST($6::int, 1)), 'confirmado')`,
            [s.salaoId, reservaId, servicoId, s.profissionalId, preco, duracao],
          ),
      };
    }

    it('CA-20: preco_centavos < 0 é rejeitado (23514)', async () => {
      const { inserir } = await itemCom(-1, 60);
      expect(await erroSql(inserir())).toEqual({ code: '23514', constraint: 'reserva_item_preco_chk' });
    });

    it.each([0, -15])('CA-20: duracao_min = %i é rejeitado (23514)', async (duracao) => {
      const { inserir } = await itemCom(8000, duracao);
      expect(await erroSql(inserir())).toEqual({ code: '23514', constraint: 'reserva_item_duracao_chk' });
    });

    it('CA-20 (controle; D-050): preço 0 e duração positiva são aceitos; encaixe false, revisao 0 e atualizado_em por padrão', async () => {
      const { reservaId, inserir } = await itemCom(0, 45);
      await inserir();
      const r = await c.query(
        `SELECT preco_centavos, duracao_min, encaixe, revisao, status::text AS status,
                atualizado_em = criado_em AS mesmo_instante
           FROM reserva_item WHERE reserva_id = $1`,
        [reservaId],
      );
      expect(r.rows).toEqual([
        { preco_centavos: 0, duracao_min: 45, encaixe: false, revisao: 0, status: 'confirmado', mesmo_instante: true },
      ]);
    });

    it('D-050: status do item não tem DEFAULT (a aplicação grava o literal): omitir é 23502', async () => {
      const { inserir } = await itemCom(1000, 45);
      expect((await erroSql(inserir(null))).code).toBe('23502');
    });
  });
});
