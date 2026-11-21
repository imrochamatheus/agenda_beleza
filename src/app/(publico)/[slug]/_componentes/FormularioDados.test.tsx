/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { EstadoReserva } from '../estado';
import { FormularioDados } from './FormularioDados';

const OCULTOS = {
  slug: 'bela',
  s: ['11111111-1111-4111-8111-111111111111'],
  p: 'qualquer',
  data: '2026-12-01',
  profissionalId: '33333333-3333-4333-8333-333333333333',
  inicio: '2026-12-01T12:00:00.000Z',
  chave: '44444444-4444-4444-8444-444444444444',
};
const RESUMO = {
  servicos: [{ nome: 'Corte', precoCentavos: 5000, duracaoMin: 30 }],
  profissionalNome: 'Ana',
  inicioIso: OCULTOS.inicio,
  fuso: 'America/Sao_Paulo',
  totalCentavos: 5000,
  duracaoTotalMin: 30,
};
const base = (o: Partial<EstadoReserva>): EstadoReserva => ({
  status: 'editando',
  mensagem: null,
  erros: {},
  valores: { nome: 'Maria', telefone: '123', mensagensReserva: true, conviteAvaliacao: true },
  chave: OCULTOS.chave,
  resumo: null,
  repetida: false,
  ...o,
});

async function enviar(estado: EstadoReserva) {
  const acao = vi.fn(async () => estado);
  render(<FormularioDados acao={acao} ocultos={OCULTOS} />);
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar reserva' }));
  await waitFor(() => expect(acao).toHaveBeenCalledTimes(1));
  return acao;
}

describe('FormularioDados (CA-7, CA-8, CA-10)', () => {
  it('envia os campos fixos e a chave de idempotência', async () => {
    const acao = await enviar(base({}));
    const fd = (acao.mock.calls[0] as unknown as [EstadoReserva, FormData])[1];
    expect([fd.get('slug'), fd.get('profissionalId'), fd.get('inicio'), fd.get('chave'), fd.getAll('s').length]).toEqual([
      'bela', OCULTOS.profissionalId, OCULTOS.inicio, OCULTOS.chave, 1,
    ]);
  });

  it('erros por campo, valores preservados e o foco no aviso geral', async () => {
    await enviar(base({ mensagem: 'Revise.', erros: { nome: 'Nome curto.', telefone: 'Telefone inválido.', mensagensReserva: 'Aceite.' } }));
    expect(await screen.findByText('Nome curto.')).toBeTruthy();
    expect(screen.getByText('Telefone inválido.')).toBeTruthy();
    expect((screen.getByRole('textbox', { name: /Nome/ }) as HTMLInputElement).value).toBe('Maria');
    expect((screen.getByRole('textbox', { name: /Telefone/ }) as HTMLInputElement).value).toBe('123');
    expect(screen.getByRole('alert').textContent).toContain('Revise.');
    expect((screen.getAllByRole('checkbox')[1] as HTMLInputElement).checked).toBe(true);
  });

  it('confirmada: serviços, profissional, data e hora no fuso do salão, total e duração', async () => {
    await enviar(base({ status: 'confirmada', resumo: RESUMO }));
    expect(await screen.findByText('Reserva confirmada!')).toBeTruthy();
    expect(screen.getByText('Corte')).toBeTruthy();
    expect(screen.getByText('Profissional: Ana')).toBeTruthy();
    expect(screen.getByText('Quando: 01/12/2026 09:00')).toBeTruthy();
    expect(screen.getByText(/Total:/).textContent).toMatch(/R\$\s*50,00/);
    expect(screen.queryByRole('button', { name: 'Confirmar reserva' })).toBeNull();
  });

  it('indisponível: aviso e nenhum formulário', async () => {
    await enviar(base({ status: 'indisponivel' }));
    expect(await screen.findByText('Agendamento indisponível')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});
