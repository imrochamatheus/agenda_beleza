import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { consultarAgenda, lerReservaDaAgenda } from '@/server/agenda/consultar';
import { repos } from '@/server/repos';
import { NaoEncontrado } from '@/server/tenant/erros';

import type { CenarioReserva } from '../../support/reservas';
import { conectar } from '../../support/sql';

import { AGORA, bloquear, criarCenario, ctxDaAna, hora, inserirCliente, reservar } from './apoio';

// D-028 T-6 (CA-11) e D-050 CA-50: isolamento entre salões X e Y em todas as leituras da agenda (reservas de 2
// itens em 2 profissionais).

let c: pg.Client;
let x: CenarioReserva;
let y: CenarioReserva;
let rx: string;
let ry: string;

beforeAll(async () => {
  c = await conectar();
  x = await criarCenario();
  y = await criarCenario();
  const cx = await inserirCliente(c, x.s.salaoId, 'Cliente do Salão X', '+5511944440001');
  const cy = await inserirCliente(c, y.s.salaoId, 'Cliente do Salão Y', '+5511944440002');
  rx = await reservar(c, x, {
    profissionalId: x.ana,
    inicio: hora('10:00'),
    clienteId: cx,
    itens: [
      { servicoId: x.A, precoCentavos: 5000, duracaoMin: 30 },
      { servicoId: x.B, precoCentavos: 7000, duracaoMin: 45, profissionalId: x.bia },
    ],
  });
  ry = await reservar(c, y, {
    profissionalId: y.ana,
    inicio: hora('10:00'),
    clienteId: cy,
    itens: [
      { servicoId: y.A, precoCentavos: 5000, duracaoMin: 30 },
      { servicoId: y.B, precoCentavos: 7000, duracaoMin: 45, profissionalId: y.bia },
    ],
  });
  await bloquear(c, x.s.salaoId, { profissionalId: x.ana, inicio: hora('13:00'), fim: hora('14:00'), motivo: 'Motivo do X' });
  await bloquear(c, y.s.salaoId, { profissionalId: null, inicio: hora('13:00'), fim: hora('14:00'), motivo: 'Motivo do Y' });
});
afterAll(async () => {
  await c.end();
});

describe('CA-11: a agenda de X nunca mostra dados de Y', () => {
  it('dia e semana, gestor e profissional: só reservas, bloqueios, nomes e profissionais de X', async () => {
    for (const ctx of [x.ctxEquipe, ctxDaAna(x)]) {
      for (const visao of ['dia', 'semana']) {
        const v = await consultarAgenda(ctx, { data: '2026-12-01', visao }, AGORA);
        const texto = JSON.stringify(v);
        expect(texto).toContain(rx);
        expect(texto).toContain('Cliente do Salão X');
        expect(texto).toContain('Motivo do X');
        for (const dadoDeY of [ry, 'Cliente do Salão Y', 'Motivo do Y', y.ana, y.bia, '5511944440002']) {
          expect(texto).not.toContain(dadoDeY);
        }
      }
    }
  });

  it('profissional de Y no filtro → NaoEncontrado; reserva de Y no detalhe → NaoEncontrado (nos dois sentidos)', async () => {
    await expect(consultarAgenda(x.ctxEquipe, { profissional: y.ana }, AGORA)).rejects.toBeInstanceOf(NaoEncontrado);
    await expect(consultarAgenda(y.ctxEquipe, { profissional: x.ana }, AGORA)).rejects.toBeInstanceOf(NaoEncontrado);
    await expect(lerReservaDaAgenda(x.ctxEquipe, ry, AGORA)).rejects.toBeInstanceOf(NaoEncontrado);
    await expect(lerReservaDaAgenda(ctxDaAna(x), ry, AGORA)).rejects.toBeInstanceOf(NaoEncontrado);
    await expect(lerReservaDaAgenda(y.ctxEquipe, rx, AGORA)).rejects.toBeInstanceOf(NaoEncontrado);
    expect((await lerReservaDaAgenda(y.ctxEquipe, ry, AGORA)).clienteNome).toBe('Cliente do Salão Y');
  });

  it('o repositório também filtra pelo salão do contexto (listagem, detalhe e jornadas)', async () => {
    const periodo = { de: hora('00:00'), ate: hora('00:00', 1) };
    const lista = await repos().agenda.listarAgenda(x.ctxEquipe, { periodo, profissionalId: null, limite: 200, comPosicao: true });
    expect(lista.blocos.map((r) => r.reservaId)).toEqual([rx, rx]);
    const cruzada = await repos().agenda.listarAgenda(x.ctxEquipe, { periodo, profissionalId: y.ana, limite: 200, comPosicao: true });
    expect(cruzada.blocos).toEqual([]);
    // D-050 CA-50: com o profissional de X, o detalhe de Y continua 404.
    await expect(repos().agenda.detalhe(x.ctxEquipe, ry, y.ana)).rejects.toBeInstanceOf(NaoEncontrado);
    await expect(repos().agenda.detalhe(y.ctxEquipe, rx, x.ana)).rejects.toBeInstanceOf(NaoEncontrado);
    await expect(repos().agenda.detalhe(x.ctxEquipe, ry, null)).rejects.toBeInstanceOf(NaoEncontrado);
    const jornadas = await repos().agenda.listarJornadas(x.ctxEquipe, null);
    expect(new Set(jornadas.map((j) => j.profissionalId))).toEqual(new Set([x.ana]));
    expect(await repos().agenda.listarJornadas(x.ctxEquipe, y.ana)).toEqual([]);
  });
});
