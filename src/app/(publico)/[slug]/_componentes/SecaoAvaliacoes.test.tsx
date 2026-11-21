/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SecaoAvaliacoes } from './SecaoAvaliacoes';

describe('SecaoAvaliacoes (CA-14, CA-15)', () => {
  it('sem avaliações: "Ainda sem avaliações" e nenhuma nota', () => {
    render(<SecaoAvaliacoes avaliacoes={{ total: 0, media: null, itens: [] }} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Avaliações' })).toBeTruthy();
    expect(screen.getByText('Ainda sem avaliações')).toBeTruthy();
    expect(screen.queryByText(/de 5/)).toBeNull();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('média com vírgula, contagem com milhar e itens com nome, nota e mês', () => {
    render(
      <SecaoAvaliacoes
        avaliacoes={{
          total: 1234,
          media: 4.3,
          itens: [
            { nome: 'Maria S.', nota: 5, comentario: 'Ótimo', mesAno: 'novembro de 2026' },
            { nome: 'Ana L.', nota: 3, comentario: null, mesAno: 'outubro de 2026' },
          ],
        }}
      />,
    );
    expect(screen.getByText('4,3').tagName).toBe('STRONG');
    expect(screen.getByText(/1\.234 avaliações/)).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('Maria S.')).toBeTruthy();
    expect(screen.getByText('novembro de 2026')).toBeTruthy();
    expect(screen.getByText('Ótimo')).toBeTruthy();
  });

  it('singular para uma avaliação', () => {
    render(<SecaoAvaliacoes avaliacoes={{ total: 1, media: 5, itens: [{ nome: 'A B.', nota: 5, comentario: null, mesAno: 'maio de 2026' }] }} />);
    expect(screen.getByText(/1 avaliação$/)).toBeTruthy();
    expect(screen.getByText('5,0')).toBeTruthy();
  });

  it('HTML no comentário e no nome aparece como texto escapado, nunca como elemento', () => {
    const { container } = render(
      <SecaoAvaliacoes
        avaliacoes={{
          total: 1,
          media: 4,
          itens: [{ nome: '<i>Eu</i>', nota: 4, comentario: '<script>alert(1)</script><b>x</b>', mesAno: 'maio de 2026' }],
        }}
      />,
    );
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(container.querySelector('i')).toBeNull();
    expect(container.textContent).toContain('<script>alert(1)</script><b>x</b>');
    expect(container.textContent).toContain('<i>Eu</i>');
  });
});
