import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { consultarAgenda } from '@/server/agenda/consultar';
import { conferirVigencia } from '@/server/mensagens/elegibilidade';
import type { TipoMensagem } from '@/server/mensagens/tipos';
import { repos } from '@/server/repos';

import { criarMensagem } from '../../support/mensagens';
import type { EstadoMsg } from '../../support/mensagens';
import { instalarContadorDeComandos } from '../../support/reservas';
import type { CenarioReserva } from '../../support/reservas';
import { conectar } from '../../support/sql';

import { AGORA, criarCenario, ctxDaAna, hora, reservar } from './apoio';

// D-043 T-4: marca de falha de mensagem vigente na agenda (CA-8, CA-9, CA-10), paridade com
// `conferirVigencia` (D-024) e o número de instruções SQL (6, constante).

let c: pg.Client;
const DIA = '2026-12-01';

beforeAll(async () => {
  c = await conectar();
});
afterAll(async () => {
  await c.end();
});

const todas = async (ce: CenarioReserva, data = DIA) => (await consultarAgenda(ce.ctxEquipe, { data }, AGORA)).colunas.flatMap((x) => x.reservas);
const falha = (ce: CenarioReserva, reservaId: string, tipo: TipoMensagem = 'confirmacao', revisao = 0, estado: EstadoMsg = 'falhou') =>
  criarMensagem({ salaoId: ce.s.salaoId, reservaId, tipo, revisao, estado });

describe('CA-8: flag no bloco', () => {
  it('só a reserva com confirmação falha vigente é marcada; as demais não', async () => {
    const ce = await criarCenario();
    const comFalha = await reservar(c, ce, { profissionalId: ce.ana, inicio: hora('09:00') });
    const enviada = await reservar(c, ce, { profissionalId: ce.ana, inicio: hora('10:00') });
    const pendente = await reservar(c, ce, { profissionalId: ce.ana, inicio: hora('11:00') });
    const semMsg = await reservar(c, ce, { profissionalId: ce.ana, inicio: hora('12:00') });
    await falha(ce, comFalha);
    await falha(ce, enviada, 'confirmacao', 0, 'enviada');
    await falha(ce, pendente, 'confirmacao', 0, 'pendente');
    const m = new Map((await todas(ce)).map((r) => [r.id, r.temFalhaDeMensagem]));
    expect(m.get(comFalha)).toBe(true);
    expect([enviada, pendente, semMsg].map((id) => m.get(id))).toEqual([false, false, false]);
    expect((await repos().agenda.detalhe(ce.ctxEquipe, comFalha, null)).temFalhaDeMensagem).toBe(true);
    expect((await repos().agenda.detalhe(ce.ctxEquipe, semMsg, null)).temFalhaDeMensagem).toBe(false);
  });

  it('6 instruções SQL com 1 reserva e com 50 reservas (todas com mensagem), dia e semana', async () => {
    const pouco = await criarCenario();
    const um = await reservar(c, pouco, { profissionalId: pouco.ana, inicio: hora('10:00') });
    await falha(pouco, um);
    const muito = await criarCenario();
    for (let i = 0; i < 50; i++) {
      const id = await reservar(c, muito, {
        profissionalId: i % 2 === 0 ? muito.ana : muito.bia,
        inicio: new Date(hora('06:00').getTime() + Math.floor(i / 2) * 30 * 60_000),
        itens: [{ servicoId: muito.A, precoCentavos: 5000, duracaoMin: 30 }],
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
    console.info(`[D-043 CA-8] instruções=${n.join(',')}`);
    expect(new Set(n)).toEqual(new Set([6]));
    const marcadas = (await todas(muito)).filter((r) => r.temFalhaDeMensagem).length;
    expect(marcadas).toBe(17);
  });
});

describe('CA-9: falha obsoleta não marca a grade', () => {
  it('reserva remarcada depois (revisão maior) e confirmação falha de reserva cancelada', async () => {
    const ce = await criarCenario();
    const remarcada = await reservar(c, ce, { profissionalId: ce.ana, inicio: hora('09:00') });
    await c.query('UPDATE reserva SET revisao = 1 WHERE id = $1', [remarcada]);
    await falha(ce, remarcada, 'confirmacao', 0);
    const cancelada = await reservar(c, ce, { profissionalId: ce.ana, inicio: hora('10:00'), status: 'cancelado' });
    await falha(ce, cancelada, 'confirmacao', 0);
    const vigenteDaRemarcada = await reservar(c, ce, { profissionalId: ce.ana, inicio: hora('11:00') });
    await c.query('UPDATE reserva SET revisao = 1 WHERE id = $1', [vigenteDaRemarcada]);
    await falha(ce, vigenteDaRemarcada, 'remarcacao', 1);
    const m = new Map((await todas(ce)).map((r) => [r.id, r.temFalhaDeMensagem]));
    expect([m.get(remarcada), m.get(cancelada), m.get(vigenteDaRemarcada)]).toEqual([false, false, true]);
  });
});

describe('CA-10: escopo do profissional', () => {
  it('a grade da Ana não marca nem expõe a falha da Bia', async () => {
    const ce = await criarCenario();
    const daBia = await reservar(c, ce, { profissionalId: ce.bia, inicio: hora('09:00') });
    const daAna = await reservar(c, ce, { profissionalId: ce.ana, inicio: hora('10:00') });
    await falha(ce, daBia);
    const v = await consultarAgenda(ctxDaAna(ce), { data: DIA }, AGORA);
    const reservas = v.colunas.flatMap((x) => x.reservas);
    expect(reservas.map((r) => r.id)).toEqual([daAna]);
    expect(reservas[0].temFalhaDeMensagem).toBe(false);
    expect(JSON.stringify(v)).not.toContain(daBia);
    const gestor = await todas(ce);
    expect(gestor.find((r) => r.id === daBia)!.temFalhaDeMensagem).toBe(true);
  });
});

describe('paridade com conferirVigencia (D-024 RN-16)', () => {
  it('tipo × status × revisão igual/diferente: o SQL decide como a função pura', async () => {
    const ce = await criarCenario();
    const tipos: TipoMensagem[] = ['confirmacao', 'remarcacao', 'cancelamento', 'convite_avaliacao'];
    const status = ['confirmado', 'cancelado', 'concluido', 'nao_compareceu'] as const;
    let k = 0;
    let vigentes = 0;
    for (const tipo of tipos) {
      for (const st of status) {
        for (const [revisaoDaMensagem, revisaoDaReserva] of [[2, 2], [1, 2]]) {
          const id = await reservar(c, ce, {
            profissionalId: ce.ana,
            inicio: new Date(hora('00:00', 1).getTime() + k * 60 * 60_000),
            status: st,
          });
          k += 1;
          await c.query('UPDATE reserva SET revisao = $2 WHERE id = $1', [id, revisaoDaReserva]);
          await falha(ce, id, tipo, revisaoDaMensagem);
          const esperado = conferirVigencia(tipo, { revisao: revisaoDaMensagem }, { revisao: revisaoDaReserva, status: st }) === 'vigente';
          if (esperado) vigentes += 1;
          const linha = await repos().agenda.detalhe(ce.ctxEquipe, id, null);
          expect(linha.temFalhaDeMensagem, `${tipo}/${st}/${revisaoDaMensagem}x${revisaoDaReserva}`).toBe(esperado);
        }
      }
    }
    expect(k).toBe(32);
    expect(vigentes).toBeGreaterThan(0);
  });
});
