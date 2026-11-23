/** @vitest-environment jsdom */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { FiltroDeProfissional } from './FiltroDeProfissional';

describe('FiltroDeProfissional (D-050 web-design §4.3, critério 10)', () => {
  it('nav rotulada com links GET; só o atual tem aria-current="true"', () => {
    render(
      <FiltroDeProfissional
        opcoes={[
          { rotulo: 'Todos (2)', href: '/bela?s=a', atual: false },
          { rotulo: 'Ana', href: '/bela?s=a&f=1', atual: true },
          { rotulo: 'Bia', href: '/bela?s=a&f=2', atual: false },
        ]}
      />,
    );
    const nav = screen.getByRole('navigation', { name: 'Filtrar por profissional' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((l) => [l.textContent, l.getAttribute('href'), l.getAttribute('aria-current')])).toEqual([
      ['Todos (2)', '/bela?s=a', null],
      ['Ana', '/bela?s=a&f=1', 'true'],
      ['Bia', '/bela?s=a&f=2', null],
    ]);
    expect(within(nav).getByRole('list')).toBeTruthy();
  });
});
