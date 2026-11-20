/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MENSAGENS_BLOQUEIO } from '@/server/bloqueios/tipos';

import { AvisoReservasCobertas } from './AvisoReservasCobertas';

// D-016 T-7: aviso de reservas cobertas (CA-4 na apresentação, D-18).

const M = MENSAGENS_BLOQUEIO;
const r = (id: string, cliente = 'Joana') => ({
  id,
  profissionalNome: 'Ana',
  inicioLocal: '25/12/2026 14:00',
  fimLocal: '25/12/2026 15:00',
  cliente,
});

describe('AvisoReservasCobertas', () => {
  it('sem reservas → texto de nenhuma reserva', () => {
    render(<AvisoReservasCobertas aviso={{ total: 0, reservas: [] }} />);
    expect(screen.getByText(M.semReservas)).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('com reservas → aviso, uma linha por reserva (cliente removida inclusive), sem "e mais"', () => {
    render(<AvisoReservasCobertas aviso={{ total: 2, reservas: [r('a'), r('b', 'cliente removida')] }} />);
    expect(screen.getByText(M.comReservas)).toBeTruthy();
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      '25/12/2026 14:00 a 25/12/2026 15:00 — Ana — Joana',
      '25/12/2026 14:00 a 25/12/2026 15:00 — Ana — cliente removida',
    ]);
    expect(screen.queryByText(/E mais/)).toBeNull();
  });

  it('total acima das listadas → "E mais N reserva(s)"', () => {
    render(<AvisoReservasCobertas aviso={{ total: 105, reservas: [r('a')] }} />);
    expect(screen.getByText(M.maisReservas(104))).toBeTruthy();
    expect(M.maisReservas(104)).toBe('E mais 104 reserva(s) não listada(s).');
  });
});
