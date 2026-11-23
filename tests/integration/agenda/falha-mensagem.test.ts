import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { consultarAgenda, lerReservaDaAgenda } from '@/server/agenda/consultar';
import { conferirVigencia } from '@/server/mensagens/elegibilidade';
import type { TipoMensagem } from '@/server/mensagens/tipos';
import { repos } from '@/server/repos';

import { criarMensagem } from '../../support/mensagens';
import type { EstadoMsg } from '../../support/mensagens';
import { instalarContadorDeComandos } from '../../support/reservas';
import type { CenarioReserva } from '../../support/reservas';
import { conectar } from '../../support/sql';

import { AGORA, criarCenario, ctxDaAna, hora, reservar, reservarComItens } from './apoio';
import type { StatusSql } from './apoio';

// D-043 T-4 / D-050 T-7: marca de falha de mensagem vigente na agenda (D-043 CA-8..CA-10; D-050 CA-34, RN-37),
// paridade do EXISTS (PREDICADO_VIGENTE de repos/mensagem.ts) com `conferirVigencia` e o número de
// instruções SQL (6, constante).

let c: pg.Client;
const DIA = '2026-12-01';

beforeAll(async () => {
  c = await conectar();
});
afterAll(async () => {
  await c.end();
});

const blocos = async (ce: CenarioReserva, data = DIA) => (await consultarAgenda(ce.ctxEquipe, { data }, AGORA)).colunas.flatMap((x) => x.blocos);
const falha = (ce: CenarioReserva, reservaId: string, tipo: TipoMensagem = 'confirmacao', revisao = 0, estado: EstadoMsg = 'falhou') =>
  criarMensagem({ salaoId: ce.s.salaoId, reservaId, tipo, revisao, estado });
const marcaPorReserva = async (ce: CenarioReserva) => new Map((await blocos(ce)).map((b) => [b.reservaId, b.temFalhaDeMensagem]));

describe('D-043 CA-8: flag no bloco', () => {
  it('só a reserva com confirmação falha vigente é marcada; as demais não', async () => {
    const ce = await criarCenario();
    const comFalha = await reservar(c, ce, { profissionalId: ce.ana, inicio: hora('09:00') });
    const enviada = await reservar(c, ce, { profissionalId: ce.ana, inicio: hora('10:00') });
    const pendente = await reservar(c, ce, { profissionalId: ce.ana, inicio: hora('11:00') });
    const semMsg = await reservar(c, ce, { profissionalId: ce.ana, inicio: hora('12:00') });
    await falha(ce, comFalha);
    await falha(ce, enviada, 'confirmacao', 0, 'enviada');
    await falha(ce, pendente, 'confirmacao', 0, 'pendente');
    const m = await marcaPorReserva(ce);
    expect(m.get(comFalha)).toBe(true);
    expect([enviada, pendente, semMsg].map((id) => m.get(id))).toEqual([false, false, false]);
    expect((await repos().agenda.detalhe(ce.ctxEquipe, comFalha, null)).temFalhaDeMensagem).toBe(true);
    expect((await repos().agenda.detalhe(ce.ctxEquipe, semMsg, null)).temFalhaDeMensagem).toBe(false);
  });

  it('6 instruções SQL com 1 reserva e com 50 reservas de 2 itens (todas com mensagem), dia e semana', async () => {
    const pouco = await criarCenario();
    const um = await reservar(c, pouco, { profissionalId: pouco.ana, inicio: hora('10:00') });
    await falha(pouco, um);
    const muito = await criarCenario();
    for (let i = 0; i < 50; i++) {
      const id = await reservar(c, muito, {
        profissionalId: i % 2 === 0 ? muito.ana : muito.bia,
        inicio: new Date(hora('06:00').getTime() + Math.floor(i / 2) * 30 * 60_000),
        itens: [
          { servicoId: muito.A, precoCentavos: 5000, duracaoMin: 15 },
          { servicoId: muito.B, precoCentavos: 5000, duracaoMin: 15 },
        ],
      });
      await falha(muito, id, 'confirmacao', 0, i % 3 === 0 ? 'falhou' : 'enviada');
    }
    const medir = async (ce: CenarioReserva, visao?: string) => {
      const contador = instalarContadorDeComandos();
      try {
        await consultarAgenda(ce.ctxEquipe, { data: DIA, ...(visao ? { visao } : {}) }, AGORA);
        return contador.contar();
      } finally {
        await contador.encerrar();
      }
    };
    const n = [await medir(pouco), await medir(pouco, 'semana'), await medir(muito), await medir(muito, 'semana')];
    console.info(`[D-050 CA-34] instruções=${n.join(',')}`);
    expect(new Set(n)).toEqual(new Set([6]));
    const todos = await blocos(muito);
    expect(todos).toHaveLength(100);
    // 17 reservas com falha × 2 blocos cada.
    expect(todos.filter((b) => b.temFalhaDeMensagem)).toHaveLength(34);
  });
});

describe('D-050 CA-34 / RN-37: todos os blocos visíveis da reserva mostram a falha', () => {
  async function tresItens(ce: CenarioReserva) {
    const { rows } = await c.query<{ id: string }>("INSERT INTO profissional (salao_id, nome) VALUES ($1, 'Carla') RETURNING id::text AS id", [ce.s.salaoId]);
    const { rows: sv } = await c.query<{ id: string }>(
      "INSERT INTO servico (salao_id, nome, preco_centavos, duracao_min) VALUES ($1, 'Manicure', 4000, 45) RETURNING id::text AS id",
      [ce.s.salaoId],
    );
    return reservarComItens(c, ce, {
      profissionalId: ce.ana,
      inicio: hora('09:00'),
      revisao: 1,
      itens: [
        { servicoId: ce.A, precoCentavos: 5000, duracaoMin: 60, profissionalId: ce.bia, inicio: hora('09:00') },
        { servicoId: ce.B, precoCentavos: 5000, duracaoMin: 60, profissionalId: ce.ana, inicio: hora('10:00') },
        { servicoId: sv[0].id, precoCentavos: 4000, duracaoMin: 45, profissionalId: rows[0].id, inicio: hora('15:00') },
      ],
    });
  }

  it('falha da remarcação do item da Bia marca os 3 blocos (gestor) e o bloco e o detalhe da Ana (profissional)', async () => {
    const ce = await criarCenario();
    const { reservaId, itemIds } = await tresItens(ce);
    // O item da Bia foi remarcado (revisão 1) e a mensagem falhou: vigente (item confirmado com a mesma revisão).
    await c.query('UPDATE reserva_item SET revisao = 1 WHERE id = $1', [itemIds[0]]);
    await c.query('UPDATE reserva_item SET revisao = 0 WHERE id = ANY($1::uuid[])', [[itemIds[1], itemIds[2]]]);
    await falha(ce, reservaId, 'remarcacao', 1);
    const todos = (await blocos(ce)).sort((a, b) => a.inicio.getTime() - b.inicio.getTime());
    expect(todos.map((b) => [b.itemId, b.temFalhaDeMensagem])).toEqual(itemIds.map((id) => [id, true]));
    const daAna = (await consultarAgenda(ctxDaAna(ce), { data: DIA }, AGORA)).colunas.flatMap((x) => x.blocos);
    expect(daAna.map((b) => [b.itemId, b.temFalhaDeMensagem])).toEqual([[itemIds[1], true]]);
    expect((await lerReservaDaAgenda(ctxDaAna(ce), reservaId, AGORA)).temFalhaDeMensagem).toBe(true);
  });

  it('sem falha vigente nenhum bloco é marcado', async () => {
    const ce = await criarCenario();
    const { reservaId } = await tresItens(ce);
    await falha(ce, reservaId, 'confirmacao', 0, 'enviada');
    expect((await blocos(ce)).map((b) => b.temFalhaDeMensagem)).toEqual([false, false, false]);
  });
});

describe('D-043 CA-9 (regra D-050 M-4): falha obsoleta não marca a grade', () => {
  it('remarcação falha superada por outra remarcação do item; confirmação falha de reserva cancelada', async () => {
    const ce = await criarCenario();
    // Item remarcado de novo (revisão 2): a falha da revisão 1 ficou obsoleta.
    const superada = await reservarComItens(c, ce, { profissionalId: ce.ana, inicio: hora('09:00'), revisao: 2 });
    await falha(ce, superada.reservaId, 'remarcacao', 1);
    const cancelada = await reservar(c, ce, { profissionalId: ce.ana, inicio: hora('10:00'), status: 'cancelado' });
    await falha(ce, cancelada, 'confirmacao', 0);
    const vigente = await reservarComItens(c, ce, { profissionalId: ce.ana, inicio: hora('11:00'), revisao: 1 });
    await falha(ce, vigente.reservaId, 'remarcacao', 1);
    // M-4: a confirmação não compara revisão — continua vigente enquanto a reserva estiver confirmada.
    const confirmacaoDepoisDeRemarcar = await reservarComItens(c, ce, { profissionalId: ce.ana, inicio: hora('12:00'), revisao: 1 });
    await falha(ce, confirmacaoDepoisDeRemarcar.reservaId, 'confirmacao', 0);
    const m = await marcaPorReserva(ce);
    expect([m.get(superada.reservaId), m.get(cancelada), m.get(vigente.reservaId), m.get(confirmacaoDepoisDeRemarcar.reservaId)]).toEqual([
      false,
      false,
      true,
      true,
    ]);
  });
});

describe('D-043 CA-10: escopo do profissional', () => {
  it('a grade da Ana não marca nem expõe a falha de uma reserva só da Bia', async () => {
    const ce = await criarCenario();
    const daBia = await reservar(c, ce, { profissionalId: ce.bia, inicio: hora('09:00') });
    const daAna = await reservar(c, ce, { profissionalId: ce.ana, inicio: hora('10:00') });
    await falha(ce, daBia);
    const v = await consultarAgenda(ctxDaAna(ce), { data: DIA }, AGORA);
    const bl = v.colunas.flatMap((x) => x.blocos);
    expect(bl.map((b) => b.reservaId)).toEqual([daAna]);
    expect(bl[0].temFalhaDeMensagem).toBe(false);
    expect(JSON.stringify(v)).not.toContain(daBia);
    expect((await marcaPorReserva(ce)).get(daBia)).toBe(true);
  });
});

describe('paridade com conferirVigencia (D-050 M-4): o EXISTS da agenda decide como a função pura', () => {
  it('tipo × status do item × revisão do item igual/diferente, com um segundo item de outro status', async () => {
    const ce = await criarCenario();
    const tipos: TipoMensagem[] = ['confirmacao', 'remarcacao', 'cancelamento', 'convite_avaliacao'];
    const status: StatusSql[] = ['confirmado', 'cancelado', 'concluido', 'nao_compareceu'];
    let k = 0;
    let vigentes = 0;
    let obsoletas = 0;
    for (const tipo of tipos) {
      for (const st of status) {
        for (const outro of status) {
          for (const revisaoDoItem of [1, 2]) {
            const revisaoDaMensagem = 1;
            const base = new Date(hora('00:00', 1).getTime() + k * 2 * 60 * 60_000);
            k += 1;
            const { reservaId, itemIds } = await reservarComItens(c, ce, {
              profissionalId: ce.ana,
              inicio: base,
              revisao: 2,
              itens: [
                { servicoId: ce.A, precoCentavos: 5000, duracaoMin: 30, status: st },
                { servicoId: ce.B, precoCentavos: 5000, duracaoMin: 30, status: outro, profissionalId: ce.bia },
              ],
            });
            await c.query('UPDATE reserva_item SET revisao = $2 WHERE id = $1', [itemIds[0], revisaoDoItem]);
            await c.query('UPDATE reserva_item SET revisao = 0 WHERE id = $1', [itemIds[1]]);
            await falha(ce, reservaId, tipo, revisaoDaMensagem);
            const det = await repos().agenda.detalhe(ce.ctxEquipe, reservaId, null);
            const esperado =
              conferirVigencia(tipo, { revisao: revisaoDaMensagem }, {
                status: det.status,
                itens: [
                  { revisao: revisaoDoItem, status: st },
                  { revisao: 0, status: outro },
                ],
              }) === 'vigente';
            if (esperado) vigentes += 1;
            else obsoletas += 1;
            expect(det.temFalhaDeMensagem, `${tipo}/${st}+${outro}/item r${revisaoDoItem}`).toBe(esperado);
          }
        }
      }
    }
    expect(k).toBe(128);
    expect(vigentes).toBeGreaterThan(10);
    expect(obsoletas).toBeGreaterThan(10);
  }, 60_000);
});
