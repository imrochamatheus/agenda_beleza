import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DetalheDaReserva } from '@/app/painel/agenda/_componentes/DetalheDaReserva';
import { VistaDaAgenda } from '@/app/painel/agenda/_componentes/VistaDaAgenda';
import { consultarAgenda, lerReservaDaAgenda } from '@/server/agenda/consultar';

import { conectar } from '../../support/sql';

import { AGORA, criarCenario, hora, reservar } from './apoio';

// D-028 T-6 (CA-3, CA-13): horários no fuso do salão, iguais com TZ=UTC e TZ=America/Sao_Paulo no
// processo (rodar nos dois: ver "Fuso da agenda" no CLAUDE.md), inclusive dias de 23 h e 25 h.

let c: pg.Client;
beforeAll(async () => {
  c = await conectar();
});
afterAll(async () => {
  await c.end();
});

const html = (vista: Awaited<ReturnType<typeof consultarAgenda>>) =>
  renderToStaticMarkup(createElement(VistaDaAgenda, { vista, base: '/painel/agenda', hrefReserva: (id: string) => `/r/${id}` }));

describe('CA-3: 12:00Z em America/Sao_Paulo é 09:00', () => {
  it('na agenda (dia e semana) e no detalhe', async () => {
    const ce = await criarCenario();
    const id = await reservar(c, ce, { profissionalId: ce.ana, inicio: new Date('2026-12-01T12:00:00Z') });
    for (const visao of ['dia', 'semana']) {
      const marcado = html(await consultarAgenda(ce.ctxEquipe, { data: '2026-12-01', visao }, AGORA));
      expect(marcado).toContain('09:00–10:00');
      expect(marcado).not.toContain('12:00–13:00');
    }
    const d = await lerReservaDaAgenda(ce.ctxEquipe, id);
    const detalhe = renderToStaticMarkup(createElement(DetalheDaReserva, { reserva: d, hrefVoltar: '/x' }));
    expect(detalhe).toContain('01/12/2026 09:00');
    expect(detalhe).toContain('01/12/2026 10:00');
  });

  it('fuso do salão diferente do de São Paulo (Manaus, UTC−4): 12:00Z é 08:00', async () => {
    const ce = await criarCenario({ fuso: 'America/Manaus' });
    await reservar(c, ce, { profissionalId: ce.ana, inicio: new Date('2026-12-01T12:00:00Z') });
    expect(html(await consultarAgenda(ce.ctxEquipe, { data: '2026-12-01' }, AGORA))).toContain('08:00–09:00');
  });
});

describe('CA-13: virada de dia e horário de verão', () => {
  it('reserva 23:00–01:00 local: 23:00–24:00 num dia e 00:00–01:00 no seguinte', async () => {
    const ce = await criarCenario();
    await reservar(c, ce, { profissionalId: ce.ana, inicio: hora('23:00'), fim: hora('01:00', 1) });
    expect(html(await consultarAgenda(ce.ctxEquipe, { data: '2026-12-01' }, AGORA))).toContain('23:00–24:00');
    expect(html(await consultarAgenda(ce.ctxEquipe, { data: '2026-12-02' }, AGORA))).toContain('00:00–01:00');
  });

  it('dia de 23 h (08/03/2026, Nova York): renderiza, com os horários de parede corretos', async () => {
    const ce = await criarCenario({ fuso: 'America/New_York' });
    // 01:30 EST (06:30Z) a 03:30 EDT (07:30Z): uma hora real, atravessa o salto.
    await reservar(c, ce, { profissionalId: ce.ana, inicio: new Date('2026-03-08T06:30:00Z'), fim: new Date('2026-03-08T07:30:00Z') });
    await reservar(c, ce, { profissionalId: ce.ana, inicio: new Date('2026-03-08T16:00:00Z'), fim: new Date('2026-03-08T17:00:00Z'), status: 'cancelado' });
    const v = await consultarAgenda(ce.ctxEquipe, { data: '2026-03-08' }, new Date('2026-03-01T12:00:00Z'));
    expect((v.dias[0].fim.getTime() - v.dias[0].inicio.getTime()) / 3_600_000).toBe(23);
    const marcado = html(v);
    expect(marcado).toContain('01:30–03:30');
    expect(marcado).toContain('12:00–13:00');
    const semana = await consultarAgenda(ce.ctxEquipe, { data: '2026-03-08', visao: 'semana' }, new Date('2026-03-01T12:00:00Z'));
    expect(semana.dias).toHaveLength(7);
    expect(html(semana)).toContain('01:30–03:30');
  });

  it('dia de 25 h (01/11/2026, Nova York): renderiza e a reserva da hora repetida aparece', async () => {
    const ce = await criarCenario({ fuso: 'America/New_York' });
    await reservar(c, ce, { profissionalId: ce.ana, inicio: new Date('2026-11-01T05:30:00Z'), fim: new Date('2026-11-01T06:30:00Z') });
    await reservar(c, ce, { profissionalId: ce.ana, inicio: new Date('2026-11-01T14:00:00Z'), fim: new Date('2026-11-01T15:00:00Z'), status: 'cancelado' });
    const v = await consultarAgenda(ce.ctxEquipe, { data: '2026-11-01' }, new Date('2026-10-25T12:00:00Z'));
    expect((v.dias[0].fim.getTime() - v.dias[0].inicio.getTime()) / 3_600_000).toBe(25);
    expect(v.colunas[0].reservas).toHaveLength(2);
    const marcado = html(v);
    // Hora repetida: 01:30 EDT → 01:30 EST (1 h real) mostra a duração real: 01:30–02:30.
    expect(marcado).toContain('01:30–02:30');
    expect(marcado).toContain('09:00–10:00');
  });
});
