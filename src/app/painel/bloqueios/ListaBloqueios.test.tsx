/** @vitest-environment jsdom */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MENSAGENS_BLOQUEIO } from '@/server/bloqueios/tipos';
import type { BloqueioItem } from '@/server/bloqueios/tipos';

import { AlertaDeRemocao, ListaBloqueios } from './ListaBloqueios';

// D-016 T-7: lista (CA-14, CA-15, CA-18 na apresentação): editar/remover só nos editáveis.

const M = MENSAGENS_BLOQUEIO;
const ITENS: BloqueioItem[] = [
  {
    id: 'b-salao',
    alvo: { tipo: 'salao' },
    inicio: '2026-12-25T03:00:00.000Z',
    fim: '2026-12-26T03:00:00.000Z',
    diaInteiro: true,
    periodo: '25/12/2026 (dia inteiro)',
    motivo: 'Natal',
    editavel: false,
  },
  {
    id: 'b-ana',
    alvo: { tipo: 'profissional', id: 'p1', nome: 'Ana', ativo: true },
    inicio: '2026-12-26T01:00:00.000Z',
    fim: '2026-12-26T05:00:00.000Z',
    diaInteiro: false,
    periodo: '25/12/2026 22:00 a 26/12/2026 02:00',
    motivo: null,
    editavel: true,
  },
  {
    id: 'b-bia',
    alvo: { tipo: 'profissional', id: 'p2', nome: 'Bia', ativo: false },
    inicio: '2026-12-27T03:00:00.000Z',
    fim: '2026-12-28T03:00:00.000Z',
    diaInteiro: true,
    periodo: '27/12/2026 (dia inteiro)',
    motivo: null,
    editavel: true,
  },
];

describe('ListaBloqueios', () => {
  it('vazia → texto de nenhum bloqueio', () => {
    render(<ListaBloqueios itens={[]} acaoRemover={vi.fn()} />);
    expect(screen.getByText(M.vazio)).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('um item por bloqueio: alvo, período e motivo; somente leitura sem editar nem remover', () => {
    render(<ListaBloqueios itens={ITENS} acaoRemover={vi.fn()} />);
    const itens = screen.getAllByRole('listitem');
    expect(itens).toHaveLength(3);
    const [salao, ana, bia] = itens;
    expect(within(salao).getByText('Salão inteiro')).toBeTruthy();
    expect(within(salao).getByText('25/12/2026 (dia inteiro)')).toBeTruthy();
    expect(within(salao).getByText('Motivo: Natal')).toBeTruthy();
    expect(within(salao).getByText(M.somenteLeitura)).toBeTruthy();
    expect(within(salao).queryByRole('link')).toBeNull();
    expect(within(salao).queryByRole('button')).toBeNull();
    expect(within(ana).queryByText(/Motivo/)).toBeNull();
    expect(within(bia).getByText('Bia (inativo)')).toBeTruthy();
  });

  it('editável: link de edição e formulário de remoção com id oculto e nomes acessíveis completos', () => {
    render(<ListaBloqueios itens={ITENS} acaoRemover={vi.fn()} />);
    const ana = screen.getAllByRole('listitem')[1];
    const editar = within(ana).getByRole('link', { name: 'Editar bloqueio: Ana, 25/12/2026 22:00 a 26/12/2026 02:00' });
    expect(editar.getAttribute('href')).toBe('/painel/bloqueios/b-ana');
    expect(editar.textContent).toBe('Editar');
    const remover = within(ana).getByRole('button', { name: 'Remover bloqueio: Ana, 25/12/2026 22:00 a 26/12/2026 02:00' }) as HTMLButtonElement;
    expect(remover.type).toBe('submit');
    expect((remover.form!.querySelector('input[name="id"]') as HTMLInputElement).value).toBe('b-ana');
    expect(within(screen.getAllByRole('listitem')[2]).getByRole('button', { name: /Remover bloqueio: Bia \(inativo\)/ })).toBeTruthy();
  });

  it('rota de edição configurável (demonstração)', () => {
    render(<ListaBloqueios itens={ITENS} acaoRemover={vi.fn()} rotaEdicao={(id) => `/dev/bloqueios?modo=edicao&id=${id}`} />);
    expect(screen.getAllByRole('link')[0].getAttribute('href')).toBe('/dev/bloqueios?modo=edicao&id=b-ana');
  });
});

describe('AlertaDeRemocao (PRG ?remocao=)', () => {
  it.each([
    ['ok', 'status', M.removido],
    ['nao_encontrado', 'alert', M.naoEncontrado],
    ['negado', 'alert', M.acessoNegado],
  ])('%s → %s com o texto', (remocao, papel, texto) => {
    render(<AlertaDeRemocao remocao={remocao} />);
    expect(screen.getByRole(papel).textContent).toContain(texto);
  });

  it('outro valor, ausente ou repetido → nada', () => {
    const { container } = render(
      <>
        <AlertaDeRemocao remocao="x" />
        <AlertaDeRemocao remocao={undefined} />
        <AlertaDeRemocao remocao={['ok', 'ok']} />
      </>,
    );
    expect(container.innerHTML).toBe('');
  });
});
