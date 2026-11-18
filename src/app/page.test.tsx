/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import Home from './page';

describe('Home', () => {
  it('mostra o título "Agenda Beleza" como h1 (CA-7)', () => {
    render(<Home />);

    const heading = screen.getByRole('heading', { level: 1, name: 'Agenda Beleza' });
    expect(heading.tagName).toBe('H1');
    expect(screen.getByRole('main').contains(heading)).toBe(true);
  });

  it('mostra texto provisório em pt-BR', () => {
    render(<Home />);

    expect(
      screen.getByText('Em breve: agende seu horário no salão de forma simples e rápida.'),
    ).toBeInstanceOf(HTMLParagraphElement);
  });
});
