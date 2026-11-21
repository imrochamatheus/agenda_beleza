import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { remarcarReserva } from '@/server/reservas/remarcar';

import { AGORA, criarCenario, criarConfirmada, filaEspia, reservaDe } from './apoio';

// D-030: a data e a hora da remarcação são do fuso do SALÃO, convertidas só por tempo/fuso.ts; o resultado
// não depende do fuso do processo (rodar com TZ=UTC e TZ=America/Sao_Paulo).

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterAll(() => {
  vi.restoreAllMocks();
});

describe('fuso do salão', () => {
  it.each([
    ['America/Sao_Paulo', '2026-12-01T13:00:00.000Z'],
    ['America/New_York', '2026-12-01T15:00:00.000Z'],
    ['Asia/Tokyo', '2026-12-01T01:00:00.000Z'],
  ])('10:00 local em %s vira %s em UTC', async (fuso, utc) => {
    const c = await criarCenario({ fuso });
    const id = await criarConfirmada(c, { hora: '09:00' });
    const r = await remarcarReserva(
      c.ctxEquipe,
      { reservaId: id, data: '2026-12-01', hora: '10:00', profissionalId: c.ana, servicoIds: [c.A], confirmarEncaixe: true },
      AGORA,
      { enfileirar: filaEspia().enfileirar },
    );
    expect(r.resultado).toBe('atualizada');
    expect((await reservaDe(id)).inicio.toISOString()).toBe(utc);
  });

  it('virada de dia local: 23:30 em São Paulo (02:30Z do dia seguinte) com confirmação de encaixe', async () => {
    const c = await criarCenario();
    const id = await criarConfirmada(c);
    const r = await remarcarReserva(
      c.ctxEquipe,
      { reservaId: id, data: '2026-12-01', hora: '23:30', profissionalId: c.ana, servicoIds: [c.A], confirmarEncaixe: 'on' },
      AGORA,
      { enfileirar: filaEspia().enfileirar },
    );
    expect(r.resultado).toBe('atualizada');
    expect((await reservaDe(id)).inicio.toISOString()).toBe('2026-12-02T02:30:00.000Z');
  });
});
