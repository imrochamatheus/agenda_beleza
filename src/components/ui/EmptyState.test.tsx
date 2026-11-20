/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { EmptyState } from './EmptyState';

describe('EmptyState (CA-17, RN-19)', () => {
  it('título em h2 por padrão, descrição e ação', () => {
    render(
      <EmptyState
        titulo="Nenhum serviço cadastrado."
        descricao="Cadastre o primeiro serviço."
        acao={<a href="#cadastrar-servico">Cadastrar serviço</a>}
      />,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Nenhum serviço cadastrado.' })).toBeTruthy();
    expect(screen.getByText('Cadastre o primeiro serviço.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Cadastrar serviço' })).toBeTruthy();
  });

  it('nível 3 e sem descrição nem ação', () => {
    const { container } = render(<EmptyState titulo="Vazio." nivelTitulo={3} />);
    expect(screen.getByRole('heading', { level: 3, name: 'Vazio.' })).toBeTruthy();
    expect(container.firstElementChild!.children).toHaveLength(1);
  });
});
