import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { conectar, criarCenario, criarProfissional, criarSalao, criarServico, erroSql, inserirReserva } from '../support/sql';

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

  it('CA-20 (spec §3.2): a reserva nasce confirmada, com revisao 0', async () => {
    const s = await criarCenario(c);
    const id = await c.query<{ id: string }>(
      `INSERT INTO reserva (salao_id, profissional_id, cliente_id, inicio, fim, ocupado_ate, origem)
       VALUES ($1, $2, $3, '2026-12-01T10:00:00Z', '2026-12-01T11:00:00Z', '2026-12-01T11:00:00Z', 'equipe') RETURNING id`,
      [s.salaoId, s.profissionalId, s.clienteId],
    );
    const r = await c.query('SELECT status, revisao, encaixe FROM reserva WHERE id = $1', [id.rows[0].id]);
    expect(r.rows).toEqual([{ status: 'confirmado', revisao: 0, encaixe: false }]);
  });

  describe('reserva_item (snapshot)', () => {
    async function itemCom(preco: number, duracao: number) {
      const s = await criarCenario(c);
      const reservaId = await inserirReserva(c, { ...s, inicio: '2026-12-01T10:00:00Z', fim: '2026-12-01T11:00:00Z' });
      const servicoId = await criarServico(c, s.salaoId);
      return {
        reservaId,
        inserir: () =>
          c.query(
            `INSERT INTO reserva_item (salao_id, reserva_id, servico_id, ordem, preco_centavos, duracao_min)
             VALUES ($1, $2, $3, 1, $4, $5)`,
            [s.salaoId, reservaId, servicoId, preco, duracao],
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

    it('CA-20 (controle): preço 0 e duração positiva são aceitos e o snapshot é gravado', async () => {
      const { reservaId, inserir } = await itemCom(0, 45);
      await inserir();
      const r = await c.query('SELECT preco_centavos, duracao_min FROM reserva_item WHERE reserva_id = $1', [
        reservaId,
      ]);
      expect(r.rows).toEqual([{ preco_centavos: 0, duracao_min: 45 }]);
    });
  });
});
