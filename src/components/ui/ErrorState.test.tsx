/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ErrorState } from './ErrorState';

describe('ErrorState (CA-17, RN-19)', () => {
  it('role="alert", título, descrição e "Tentar novamente" chama o callback', () => {
    const tentar = vi.fn();
    render(
      <ErrorState
        titulo="Não foi possível carregar a agenda."
        descricao="Verifique a conexão."
        onTentarNovamente={tentar}
        saida={<a href="/termos">Voltar ao início</a>}
      />,
    );
    const alerta = screen.getByRole('alert');
    expect(alerta.querySelector('h2')!.textContent).toBe('Não foi possível carregar a agenda.');
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(tentar).toHaveBeenCalledTimes(1);
    expect(tentar).toHaveBeenCalledWith();
    expect(screen.getByRole('link', { name: 'Voltar ao início' })).toBeTruthy();
  });

  it('rótulo sobrescrevível, nível 3, só com saída', () => {
    render(<ErrorState titulo="Falhou." nivelTitulo={3} saida={<a href="/termos">Sair</a>} rotuloTentarNovamente="De novo" />);
    expect(screen.getByRole('heading', { level: 3, name: 'Falhou.' })).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('sem ações não renderiza a área de ações', () => {
    render(<ErrorState titulo="Falhou." />);
    expect(screen.getByRole('alert').children).toHaveLength(1);
  });

  it('com callback e rótulo próprio', () => {
    render(<ErrorState titulo="Falhou." onTentarNovamente={() => {}} rotuloTentarNovamente="De novo" />);
    expect(screen.getByRole('button', { name: 'De novo' })).toBeTruthy();
  });
});
