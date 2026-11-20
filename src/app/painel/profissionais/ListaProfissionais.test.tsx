/** @vitest-environment jsdom */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ProfissionalVisao } from '@/server/profissionais/tipos';

import { ListaProfissionais } from './ListaProfissionais';

// D-013 T-5: CA-16 (lista): nome com link para a edição, estado e acesso; estado vazio com chamada.

const p = (parcial: Partial<ProfissionalVisao>): ProfissionalVisao => ({
  id: 'id',
  nome: 'Nome',
  email: null,
  ativo: true,
  acesso: 'sem_acesso',
  emailLogin: null,
  emailBloqueado: false,
  ...parcial,
});

describe('ListaProfissionais', () => {
  it('uma linha por profissional, na ordem recebida, com Nome (link), Estado e Acesso', () => {
    render(
      <ListaProfissionais
        profissionais={[
          p({ id: 'g 1', nome: 'Gabi', acesso: 'voce', emailBloqueado: true }),
          p({ id: 'p2', nome: 'Paula', acesso: 'com_acesso' }),
          p({ id: 'i3', nome: 'Íris', ativo: false }),
        ]}
      />,
    );
    const tabela = screen.getByRole('table', { name: 'Profissionais do salão' });
    expect(within(tabela).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Nome', 'Estado', 'Acesso']);
    const linhas = within(tabela).getAllByRole('row').slice(1);
    const valores = linhas.map((l) =>
      within(l)
        .getAllByRole('cell')
        .map((c) => c.querySelector('span:last-child')!.textContent),
    );
    expect(valores).toEqual([
      ['Gabi', 'Ativo', 'Você'],
      ['Paula', 'Ativo', 'Com acesso'],
      ['Íris', 'Inativo', 'Sem acesso'],
    ]);
    expect(screen.getByRole('link', { name: 'Gabi' }).getAttribute('href')).toBe('/painel/profissionais/g%201');
  });

  it('vazio: EmptyState com a chamada "Cadastrar profissional"', () => {
    render(<ListaProfissionais profissionais={[]} />);
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Nenhum profissional cadastrado' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Cadastrar profissional' }).getAttribute('href')).toBe('/painel/profissionais/novo');
  });
});
