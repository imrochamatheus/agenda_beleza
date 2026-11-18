/** @vitest-environment jsdom */
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import RootLayout, { metadata } from './layout';

type ElementWithChildren = ReactElement<{ children?: ReactNode; lang?: string }>;

describe('RootLayout', () => {
  it('declara <html lang="pt-BR"> com os filhos dentro do <body>', () => {
    const child = <p>conteúdo</p>;
    // Chamado como função para não renderizar <html> dentro de um <div> do jsdom.
    const html = RootLayout({ children: child }) as ElementWithChildren;

    expect(html.type).toBe('html');
    expect(html.props.lang).toBe('pt-BR');

    const body = html.props.children;
    expect(isValidElement(body)).toBe(true);
    expect((body as ElementWithChildren).type).toBe('body');
    expect((body as ElementWithChildren).props.children).toBe(child);
  });

  it('exporta título e descrição da marca', () => {
    expect(metadata.title).toBe('Agenda Beleza');
    expect(metadata.description).toBe('Agendamento online para salões de beleza.');
  });
});
