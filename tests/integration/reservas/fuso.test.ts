import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { consultarDisponibilidadePorServico } from '@/server/disponibilidade/servico';
import { criarReserva } from '@/server/reservas/criar-reserva';
import { obterPrisma } from '@/server/repos/db';

import { AGORA, DIA, criarCenarioReserva, entradaReserva, sp } from '../../support/reservas';

import { item, revalidacao, um } from './apoio-itens';

// D-025 T-6c: CA-22 (fuso do salão, virada de dia, horário de verão). O resultado não depende do TZ do
// processo (ver o comando de fuso no CLAUDE.md). D-050 T-5: itens; a data única é a local do salão.

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterAll(() => {
  vi.restoreAllMocks();
});

const enfileirar = async () => ({ criado: true as const, id: 'job' });
const DIA_TODO: [string, string][] = [['00:00', '24:00']];

describe('CA-22: data local do salão e gravação em UTC', () => {
  it('São Paulo: 23:30 e 00:00 locais caem em dias UTC diferentes e são aceitas', async () => {
    const c = await criarCenarioReserva({ jornada: DIA_TODO });
    const noite = await criarReserva(c.ctxEquipe, entradaReserva(c, um(c, sp(DIA, '23:30'))), { enfileirar });
    const madrugada = await criarReserva(c.ctxEquipe, entradaReserva(c, um(c, sp({ ano: 2026, mes: 12, dia: 2 }, '00:00'))), { enfileirar });
    expect(noite.resultado).toBe('criada');
    expect(madrugada.resultado).toBe('criada');
    const linhas = await obterPrisma().reserva.findMany({ where: { salaoId: c.s.salaoId }, orderBy: { inicio: 'asc' } });
    expect(linhas.map((l) => l.inicio.toISOString())).toEqual(['2026-12-02T02:30:00.000Z', '2026-12-02T03:00:00.000Z']);
    expect(linhas[0].fim.toISOString()).toBe('2026-12-02T03:00:00.000Z');
  });

  it('outro fuso (Manaus, UTC−4): a data local usada é a do salão', async () => {
    const c = await criarCenarioReserva({ fuso: 'America/Manaus', jornada: DIA_TODO });
    // 23:30 local de 01/12 = 03:30Z de 02/12.
    const r = await criarReserva(c.ctxEquipe, entradaReserva(c, um(c, new Date('2026-12-02T03:30:00Z'))), { enfileirar });
    expect(r.resultado).toBe('criada');
    // 00:00 local de 02/12 = 04:00Z.
    const r2 = await criarReserva(c.ctxEquipe, entradaReserva(c, um(c, new Date('2026-12-02T04:00:00Z'))), { enfileirar });
    expect(r2.resultado).toBe('criada');
  });

  it('reserva que cruza a meia-noite local só é aceita se a jornada permitir (jornada não cruza)', async () => {
    const c = await criarCenarioReserva({ jornada: DIA_TODO });
    const r = await criarReserva(c.ctxEquipe, entradaReserva(c, um(c, sp(DIA, '23:45'))), { enfileirar });
    expect(r).toEqual(revalidacao());
  });

  it('horário de verão (New York, 2027-03-14): aceita exatamente o que a consulta oferece e nunca 02:xx local', async () => {
    const agora = new Date('2027-03-01T15:00:00Z');
    const c = await criarCenarioReserva({ fuso: 'America/New_York', jornada: DIA_TODO });
    const dia = { ano: 2027, mes: 3, dia: 14 };
    const consulta = await consultarDisponibilidadePorServico(c.ctxSistema, { servicoIds: [c.A], de: dia, ate: dia, agora });
    if (consulta.resultado !== 'ok') throw new Error('consulta inesperada');
    const horarios = consulta.servicos[0].profissionais.find((p) => p.profissionalId === c.ana)!.dias[0].horarios;
    expect(horarios.some((h) => h.local.minutosDoDia >= 120 && h.local.minutosDoDia < 180)).toBe(false);
    const oferecidos = new Set(horarios.map((h) => h.inicio.getTime()));
    // 05:00Z–10:00Z cobre 00:00 EST até 06:00 EDT de 14/03, atravessando o salto de 07:00Z.
    const base = Date.UTC(2027, 2, 14, 5, 0);
    let aceitas = 0;
    for (let m = 0; m <= 5 * 60; m += 15) {
      const inicio = new Date(base + m * 60_000);
      const r = await criarReserva(c.ctxEquipe, entradaReserva(c, { ...um(c, inicio), agora }), { enfileirar });
      expect(r.resultado === 'criada', inicio.toISOString()).toBe(oferecidos.has(inicio.getTime()));
      if (r.resultado === 'criada') {
        aceitas += 1;
        await obterPrisma().reservaItem.updateMany({ where: { reservaId: r.reserva.id }, data: { status: 'cancelado' } });
        await obterPrisma().reserva.update({ where: { id: r.reserva.id }, data: { status: 'cancelado', canceladaEm: new Date() } });
      }
    }
    expect(aceitas).toBeGreaterThan(0);
    expect(AGORA.getTime()).toBeLessThan(agora.getTime());
  });
});

describe('D-050 RN-3 no fuso do salão: a data única é a local, não a UTC', () => {
  it('São Paulo: 20:00 e 23:00 locais de 01/12 (23:00Z de 01/12 e 02:00Z de 02/12) são a mesma data', async () => {
    const c = await criarCenarioReserva({ jornada: [['00:00', '24:00']] });
    const r = await criarReserva(
      c.ctxEquipe,
      entradaReserva(c, { itens: [item(c, sp(DIA, '20:00')), item(c, sp(DIA, '23:00'), { servicoId: c.B })] }),
      { enfileirar },
    );
    expect(r.resultado).toBe('criada');
    if (r.resultado !== 'criada') return;
    expect(r.reserva.itens.map((i) => i.inicio.toISOString())).toEqual(['2026-12-01T23:00:00.000Z', '2026-12-02T02:00:00.000Z']);
  });

  it('Manaus (UTC−4): 21:00Z e 03:00Z do dia seguinte são 17:00 e 23:00 de 01/12 locais: aceito', async () => {
    const c = await criarCenarioReserva({ fuso: 'America/Manaus', jornada: [['00:00', '24:00']] });
    const r = await criarReserva(
      c.ctxEquipe,
      entradaReserva(c, { itens: [item(c, new Date('2026-12-01T21:00:00Z')), item(c, new Date('2026-12-02T03:00:00Z'), { servicoId: c.B })] }),
      { enfileirar },
    );
    expect(r.resultado).toBe('criada');
  });
});
