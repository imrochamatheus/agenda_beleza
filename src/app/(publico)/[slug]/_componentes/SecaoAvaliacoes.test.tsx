/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MENSAGENS_DENUNCIA } from '@/server/denuncias/tipos';

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
            { id: 'id-1', nome: 'Maria S.', nota: 5, comentario: 'Ótimo', mesAno: 'novembro de 2026' },
            { id: 'id-2', nome: 'Ana L.', nota: 3, comentario: null, mesAno: 'outubro de 2026' },
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
    render(<SecaoAvaliacoes avaliacoes={{ total: 1, media: 5, itens: [{ id: 'id-3', nome: 'A B.', nota: 5, comentario: null, mesAno: 'maio de 2026' }] }} />);
    expect(screen.getByText(/1 avaliação$/)).toBeTruthy();
    expect(screen.getByText('5,0')).toBeTruthy();
  });

  it('HTML no comentário e no nome aparece como texto escapado, nunca como elemento', () => {
    const { container } = render(
      <SecaoAvaliacoes
        avaliacoes={{
          total: 1,
          media: 4,
          itens: [{ id: 'id-4', nome: '<i>Eu</i>', nota: 4, comentario: '<script>alert(1)</script><b>x</b>', mesAno: 'maio de 2026' }],
        }}
      />,
    );
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(container.querySelector('i')).toBeNull();
    expect(container.textContent).toContain('<script>alert(1)</script><b>x</b>');
    expect(container.textContent).toContain('<i>Eu</i>');
  });

  const humano = { modo: 'simulado', chaveDoSite: '', tokenSimulado: 'ok', controleDeTeste: false } as const;
  const dados = { total: 2, media: 4, itens: [
    { id: 'a1', nome: 'Ana L.', nota: 4, comentario: null, mesAno: 'maio de 2026' },
    { id: 'a2', nome: 'Bia S.', nota: 4, comentario: 'Bom', mesAno: 'maio de 2026' },
  ] };

  it('com denúncia habilitada: um formulário por avaliação, com ids distintos; sem ela, nenhum', () => {
    const { container, rerender } = render(<SecaoAvaliacoes avaliacoes={dados} />);
    expect(container.querySelectorAll('details')).toHaveLength(0);
    rerender(<SecaoAvaliacoes avaliacoes={dados} denuncia={{ acao: async (a) => a, slug: 'meu-salao', humano, recebida: false }} />);
    expect(container.querySelectorAll('details')).toHaveLength(2);
    expect(Array.from(container.querySelectorAll('input[name="avaliacao_id"]')).map((i) => (i as HTMLInputElement).value)).toEqual(['a1', 'a2']);
    expect(screen.queryByText(MENSAGENS_DENUNCIA.recebida)).toBeNull();
    const ids = Array.from(container.querySelectorAll('[id]')).map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('?denuncia=recebida mostra a resposta uniforme', () => {
    render(<SecaoAvaliacoes avaliacoes={dados} denuncia={{ acao: async (a) => a, slug: 's', humano, recebida: true }} />);
    expect(screen.getByText(MENSAGENS_DENUNCIA.recebida)).toBeTruthy();
  });
});
