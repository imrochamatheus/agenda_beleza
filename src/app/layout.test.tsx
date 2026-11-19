/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

// next/font/local é uma macro de compilação do Next, vazia fora dele (D-009 R-3).
vi.mock('next/font/local', () => ({
  default: (o: { variable: string }) => ({
    className: `cls${o.variable}`,
    variable: `var${o.variable}`,
    style: { fontFamily: 'x' },
  }),
}));

const { default: RootLayout, metadata } = await import('./layout');

type ElementWithChildren = ReactElement<{ children?: ReactNode; lang?: string; className?: string }>;

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

  it('CA-19: aplica as classes variable das duas fontes no <html>', () => {
    const html = RootLayout({ children: null }) as ElementWithChildren;
    expect(html.props.className?.split(' ').sort()).toEqual(
      ['var--fonte-corpo', 'var--fonte-titulo'].sort(),
    );
  });

  it('CA-19: importa o globals.css', () => {
    // No ambiente jsdom, import.meta.url não é file:; o Vitest roda na raiz do projeto.
    const fonte = readFileSync(join(process.cwd(), 'src/app/layout.tsx'), 'utf8');
    expect(fonte).toMatch(/^import '\.\/globals\.css';$/m);
  });
});
