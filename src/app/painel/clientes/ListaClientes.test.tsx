/** @vitest-environment jsdom */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ClienteVisao, ListaClientes as Lista } from '@/server/clientes/tipos';

import { BuscaClientes } from './BuscaClientes';
import { ListaClientes } from './ListaClientes';

// D-022 T-4: lista (nome, telefone formatado, link), contagem, vazio, paginação por links, busca por GET.

const c = (i: number, nome: string): ClienteVisao => ({ id: `id-${i}`, nome, telefone: `+55119876543${i}0`, telefoneFormatado: `(11) 98765-43${i}0`, anonimizada: false });
const lista = (o: Partial<Lista>): Lista => ({ itens: [], total: 0, pagina: 1, porPagina: 20, q: '', ...o });
const detalhe = (id: string) => `/painel/clientes/${id}`;
const renderizar = (l: Lista) => render(<ListaClientes lista={l} base="/painel/clientes" hrefDetalhe={detalhe} />);

describe('ListaClientes', () => {
  it('itens com nome como link para o detalhe e telefone formatado; "1 cliente"', () => {
    renderizar(lista({ itens: [c(1, 'Ana & <b>Lima</b>')], total: 1 }));
    expect(screen.getByRole('status').textContent).toBe('1 cliente');
    const link = screen.getByRole('link', { name: 'Ana & <b>Lima</b>' });
    expect(link.getAttribute('href')).toBe('/painel/clientes/id-1');
    expect(document.querySelector('b')).toBeNull();
    expect(screen.getByText('(11) 98765-4310')).toBeTruthy();
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('vazio com busca: "Nenhuma cliente encontrada." e dica; sem busca: outra dica', () => {
    const { unmount } = renderizar(lista({ q: 'xyz' }));
    expect(screen.getByRole('heading', { name: 'Nenhuma cliente encontrada.' })).toBeTruthy();
    expect(screen.getByText('Tente outro nome ou telefone.')).toBeTruthy();
    unmount();
    renderizar(lista({}));
    expect(screen.getByText(/aparecem aqui/)).toBeTruthy();
  });

  it('várias páginas: contagem, Próxima preservando a busca; sem Anterior na primeira', () => {
    renderizar(lista({ itens: [c(1, 'Ana')], total: 45, pagina: 1, q: 'a&b' }));
    expect(screen.getByRole('status').textContent).toBe('45 clientes · página 1 de 3');
    const nav = screen.getByRole('navigation', { name: 'Páginas de clientes' });
    expect(within(nav).queryByRole('link', { name: 'Anterior' })).toBeNull();
    expect(within(nav).getByRole('link', { name: 'Próxima' }).getAttribute('href')).toBe('/painel/clientes?q=a%26b&pagina=2');
  });

  it('página do meio e última: Anterior volta (página 1 sem parâmetro) e a última não tem Próxima', () => {
    const { unmount } = renderizar(lista({ itens: [c(1, 'Ana')], total: 45, pagina: 2 }));
    const nav = screen.getByRole('navigation', { name: 'Páginas de clientes' });
    expect(within(nav).getByRole('link', { name: 'Anterior' }).getAttribute('href')).toBe('/painel/clientes');
    expect(within(nav).getByRole('link', { name: 'Próxima' }).getAttribute('href')).toBe('/painel/clientes?pagina=3');
    unmount();
    renderizar(lista({ itens: [c(1, 'Ana')], total: 45, pagina: 3 }));
    expect(screen.queryByRole('link', { name: 'Próxima' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Anterior' }).getAttribute('href')).toBe('/painel/clientes?pagina=2');
  });

  it('página além da última: aviso e link para a primeira, sem lista; Anterior limitado à última', () => {
    renderizar(lista({ itens: [], total: 45, pagina: 9, q: 'ana' }));
    expect(screen.getByText(/Esta página não tem clientes/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Voltar para a primeira página' }).getAttribute('href')).toBe('/painel/clientes?q=ana');
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.getByRole('link', { name: 'Anterior' }).getAttribute('href')).toBe('/painel/clientes?q=ana&pagina=3');
  });
});

describe('BuscaClientes', () => {
  it('<form method="get"> pesquisável, campo rotulado com o valor e botão Buscar; sem "Limpar" quando vazio', () => {
    render(<BuscaClientes base="/painel/clientes" q="" />);
    const form = screen.getByRole('search') as HTMLFormElement;
    expect([form.method, form.getAttribute('action')]).toEqual(['get', '/painel/clientes']);
    const campo = screen.getByRole('textbox', { name: 'Buscar por nome ou telefone' }) as HTMLInputElement;
    expect([campo.name, campo.value, campo.maxLength, campo.autocomplete]).toEqual(['q', '', 80, 'off']);
    expect(screen.getByRole('button', { name: 'Buscar' }).getAttribute('type')).toBe('submit');
    expect(screen.queryByRole('link', { name: 'Limpar busca' })).toBeNull();
  });

  it('com busca: valor preenchido e link "Limpar busca"', () => {
    render(<BuscaClientes base="/dev/clientes" q="ana" />);
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('ana');
    expect(screen.getByRole('link', { name: 'Limpar busca' }).getAttribute('href')).toBe('/dev/clientes');
  });
});
