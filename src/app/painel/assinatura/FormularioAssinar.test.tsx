/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { FormularioAssinar } from './FormularioAssinar';

describe('FormularioAssinar', () => {
  it('mostra o resumo e o botão; o envio chama a ação e exibe a mensagem devolvida', async () => {
    const acao = vi.fn(async () => ({ mensagem: 'Tente de novo.', sucesso: false }));
    render(<FormularioAssinar acao={acao} resumo="R$ 79,00 por mês" />);
    expect(screen.getByText('R$ 79,00 por mês')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Assinar' }));
    expect(acao).toHaveBeenCalledTimes(1);
    expect((await screen.findByRole('status')).textContent).toContain('Tente de novo.');
  });

  it('sucesso usa a variante de sucesso', async () => {
    const acao = vi.fn(async () => ({ mensagem: 'Pronto.', sucesso: true }));
    render(<FormularioAssinar acao={acao} resumo="x" />);
    fireEvent.click(screen.getByRole('button', { name: 'Assinar' }));
    expect((await screen.findByRole('status')).textContent).toContain('Sucesso:');
  });
});
