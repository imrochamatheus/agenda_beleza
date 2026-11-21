/** @vitest-environment jsdom */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ItemHistorico } from '@/server/clientes/tipos';

import { HistoricoCliente } from './HistoricoCliente';

// D-022 T-4 (CA-13): histórico com status, serviços, duração e preço; vazio; corte em 50 com total.

const item = (i: number): ItemHistorico => ({
  id: `r${i}`,
  inicioLocal: `1${i}/07/2027 23:30`,
  status: 'Confirmado',
  profissional: 'Bia',
  servicos: ['Corte', 'Escova'],
  duracaoTotal: '1 h 30 min',
  precoTotal: 'R$ 145,00',
});

describe('HistoricoCliente', () => {
  it('sem reservas: "Nenhum agendamento ainda."', () => {
    render(<HistoricoCliente itens={[]} total={0} />);
    expect(screen.getByRole('heading', { name: 'Agendamentos' })).toBeTruthy();
    expect(screen.getByText('Nenhum agendamento ainda.')).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('itens com data, status, profissional, serviços, duração e preço', () => {
    render(<HistoricoCliente itens={[item(1), item(2)]} total={2} />);
    const itens = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(itens).toHaveLength(2);
    expect(itens[0].textContent).toContain('11/07/2027 23:30');
    expect(itens[0].textContent).toContain('(Confirmado)');
    expect(itens[0].textContent).toContain('Profissional: Bia');
    expect(itens[0].textContent).toContain('Serviços: Corte, Escova');
    expect(itens[0].textContent).toContain('1 h 30 min · R$ 145,00');
    expect(screen.queryByText(/Mostrando os/)).toBeNull();
  });

  it('mais reservas que o corte: aviso com o total', () => {
    render(<HistoricoCliente itens={[item(1)]} total={60} />);
    expect(screen.getByText('Mostrando os 50 agendamentos mais recentes de 60.')).toBeTruthy();
  });
});
