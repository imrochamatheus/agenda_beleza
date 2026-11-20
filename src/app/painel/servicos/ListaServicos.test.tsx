/** @vitest-environment jsdom */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MENSAGENS_SERVICO } from '@/server/servicos/tipos';
import type { ServicoResumo } from '@/server/servicos/tipos';

import { ListaServicos } from './ListaServicos';

// D-014 T-5: CA-1 e CA-14 (lista): nome com link, preço e duração formatados, situação, profissionais
// ativos, aviso de não ofertável e estado vazio.

const NBSP = ' ';
const s = (parcial: Partial<ServicoResumo>): ServicoResumo => ({
  id: 'id',
  nome: 'Nome',
  precoCentavos: 8000,
  duracaoMin: 45,
  ativo: true,
  profissionaisAtivos: 1,
  ofertavel: true,
  ...parcial,
});

describe('ListaServicos', () => {
  it('uma linha por serviço, na ordem recebida, com as cinco colunas e o aviso de não ofertável', () => {
    render(
      <ListaServicos
        servicos={[
          s({ id: 'c 1', nome: 'Corte' }),
          s({ id: 'e2', nome: 'Escova', precoCentavos: 123456, duracaoMin: 90, profissionaisAtivos: 0, ofertavel: false }),
          s({ id: 'm3', nome: 'Mechas', precoCentavos: 0, duracaoMin: 60, ativo: false, profissionaisAtivos: 2, ofertavel: false }),
        ]}
      />,
    );
    const tabela = screen.getByRole('table', { name: 'Serviços do salão' });
    expect(within(tabela).getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Nome',
      'Preço',
      'Duração',
      'Situação',
      'Profissionais ativos',
    ]);
    const linhas = within(tabela).getAllByRole('row').slice(1);
    const valores = linhas.map((l) =>
      within(l)
        .getAllByRole('cell')
        .map((c) => c.querySelector('span:last-child')!.textContent),
    );
    expect(valores).toEqual([
      ['Corte', `R$${NBSP}80,00`, '45 min', 'Ativo', '1'],
      ['Escova', `R$${NBSP}1.234,56`, '1 h 30 min', `Ativo ${MENSAGENS_SERVICO.semProfissional}`, '0'],
      ['Mechas', `R$${NBSP}0,00`, '1 h', 'Inativo', '2'],
    ]);
    expect(screen.getAllByText(MENSAGENS_SERVICO.semProfissional)).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Corte' }).getAttribute('href')).toBe('/painel/servicos/c%201');
  });

  it('vazio: EmptyState com a chamada "Cadastrar serviço"', () => {
    render(<ListaServicos servicos={[]} />);
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Nenhum serviço cadastrado' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Cadastrar serviço' }).getAttribute('href')).toBe('/painel/servicos/novo');
  });
});
