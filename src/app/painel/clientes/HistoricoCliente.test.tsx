/** @vitest-environment jsdom */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ItemHistorico } from '@/server/clientes/tipos';

import { HistoricoCliente } from './HistoricoCliente';

// D-022 T-4 (CA-13) e D-050 RN-35: histórico com status, serviços por item (profissional, hora, preço,
// status), total dos não cancelados; vazio; corte em 50 com total.

const item = (i: number): ItemHistorico => ({
  id: `r${i}`,
  inicioLocal: `1${i}/07/2027 09:00`,
  status: 'Confirmado',
  servicos: [
    { servico: 'Corte', profissional: 'Bia', horaLocal: '09:00', status: 'Confirmado', cancelado: false, preco: 'R$ 80,00' },
    { servico: 'Escova', profissional: 'Carla', horaLocal: '14:00', status: 'Cancelado', cancelado: true, preco: 'R$ 65,00' },
  ],
  precoTotal: 'R$ 80,00',
  totalDaCancelada: false,
});

describe('HistoricoCliente', () => {
  it('sem reservas: "Nenhum agendamento ainda."', () => {
    render(<HistoricoCliente itens={[]} total={0} />);
    expect(screen.getByRole('heading', { name: 'Agendamentos' })).toBeTruthy();
    expect(screen.getByText('Nenhum agendamento ainda.')).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('reserva com data e status; cada serviço com hora, profissional, preço e status; total dos não cancelados', () => {
    render(<HistoricoCliente itens={[item(1), item(2)]} total={2} />);
    const lista = screen.getAllByRole('list')[0];
    const reservas = within(lista).getAllByRole('listitem').filter((li) => li.parentElement === lista);
    expect(reservas).toHaveLength(2);
    expect(reservas[0].textContent).toContain('11/07/2027 09:00');
    expect(reservas[0].textContent).toContain('(Confirmado)');
    const servicos = within(within(reservas[0]).getByRole('list', { name: 'Serviços' })).getAllByRole('listitem');
    expect(servicos.map((s) => s.textContent)).toEqual([
      '09:00 · Corte · com Bia · R$ 80,00 (Confirmado)',
      '14:00 · Escova · com Carla · R$ 65,00 (Cancelado)',
    ]);
    expect(reservas[0].textContent).toContain('Total: R$ 80,00');
    expect(screen.queryByText(/Mostrando os/)).toBeNull();
  });

  it('item cancelado: nome e preço riscados; o rótulo "(Cancelado)" fica fora do riscado', () => {
    render(<HistoricoCliente itens={[item(1)]} total={1} />);
    const riscado = screen.getByText('14:00 · Escova · com Carla · R$ 65,00');
    expect(riscado.className).toMatch(/itemCancelado/);
    expect(riscado.textContent).not.toContain('Cancelado');
    expect(screen.getByText('09:00 · Corte · com Bia · R$ 80,00').className).not.toMatch(/itemCancelado/);
  });

  it('reserva toda cancelada: "Total (cancelada)"', () => {
    const cancelada: ItemHistorico = { ...item(3), status: 'Cancelado', precoTotal: 'R$ 145,00', totalDaCancelada: true };
    render(<HistoricoCliente itens={[cancelada]} total={1} />);
    expect(screen.getByText('Total (cancelada): R$ 145,00')).toBeTruthy();
  });

  it('mais reservas que o corte: aviso com o total', () => {
    render(<HistoricoCliente itens={[item(1)]} total={60} />);
    expect(screen.getByText('Mostrando os 50 agendamentos mais recentes de 60.')).toBeTruthy();
  });
});
