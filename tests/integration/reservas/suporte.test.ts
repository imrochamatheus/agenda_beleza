import { describe, expect, it } from 'vitest';

import { obterPrisma } from '@/server/repos/db';

import { DIA, conferirDerivados, criarCenarioReserva, inserirReservaDireta, sp } from '../../support/reservas';

import { ocupar } from './apoio-itens';

// D-050 T-5: o suporte `inserirReservaDireta` (tests/support/reservas.ts, usado por T-6/T-12/política)
// grava reserva + 1 item coerentes, e o helper local `ocupar` grava o mesmo formato.

const db = () => obterPrisma();

describe('inserirReservaDireta', () => {
  it('padrão: 1 item confirmado do serviço A com a Ana, no mesmo salão, derivados coerentes', async () => {
    const c = await criarCenarioReserva();
    const id = await inserirReservaDireta(c, { inicio: sp(DIA, '10:00'), fim: sp(DIA, '10:30') });
    const r = await db().reserva.findUniqueOrThrow({ where: { id }, include: { itens: true } });
    expect(r).toMatchObject({ salaoId: c.s.salaoId, status: 'confirmado', canceladaEm: null, inicio: sp(DIA, '10:00'), fim: sp(DIA, '10:30') });
    expect(r.itens.map((i) => [i.salaoId, i.servicoId, i.profissionalId, i.ordem, i.inicio, i.fim, i.ocupadoAte, i.status, i.encaixe, i.duracaoMin])).toEqual([
      [c.s.salaoId, c.A, c.ana, 0, sp(DIA, '10:00'), sp(DIA, '10:30'), sp(DIA, '10:30'), 'confirmado', false, 30],
    ]);
    expect(await conferirDerivados(id)).toBe(1);
  });

  it('sobrescritas: profissional, serviço, ocupado-até, encaixe e status cancelado (cancelada_em preenchido)', async () => {
    const c = await criarCenarioReserva();
    const id = await inserirReservaDireta(c, {
      inicio: sp(DIA, '11:00'),
      fim: sp(DIA, '11:45'),
      ocupadoAte: sp(DIA, '12:00'),
      profissionalId: c.bia,
      servicoId: c.B,
      encaixe: true,
      status: 'cancelado',
    });
    const r = await db().reserva.findUniqueOrThrow({ where: { id }, include: { itens: true } });
    expect(r.status).toBe('cancelado');
    expect(r.canceladaEm).not.toBeNull();
    expect(r.itens.map((i) => [i.profissionalId, i.servicoId, i.ocupadoAte, i.encaixe, i.status, i.duracaoMin])).toEqual([
      [c.bia, c.B, sp(DIA, '12:00'), true, 'cancelado', 45],
    ]);
    expect(await conferirDerivados({ salaoId: c.s.salaoId })).toBe(1);
  });

  it('duração não inteira em minutos é recusada antes de gravar', async () => {
    const c = await criarCenarioReserva();
    await expect(inserirReservaDireta(c, { inicio: sp(DIA, '10:00'), fim: new Date(sp(DIA, '10:30').getTime() + 30_000) })).rejects.toThrow(RangeError);
    expect(await db().reserva.count({ where: { salaoId: c.s.salaoId } })).toBe(0);
  });
});

describe('ocupar (apoio-itens)', () => {
  it('mesmo formato: reserva + 1 item, derivados coerentes; cancelado com cancelada_em', async () => {
    const c = await criarCenarioReserva();
    await ocupar(c, { inicio: sp(DIA, '10:00'), fim: sp(DIA, '10:30') });
    await ocupar(c, { inicio: sp(DIA, '10:00'), fim: sp(DIA, '10:30'), status: 'cancelado' });
    expect(await conferirDerivados({ salaoId: c.s.salaoId })).toBe(2);
  });
});
