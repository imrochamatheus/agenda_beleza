/** @vitest-environment jsdom */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { DetalheDaAvaliacao, FilaModeracao, ItemDaFila } from '@/server/denuncias/tipos';

import { DetalheDaModeracao } from './DetalheDaModeracao';
import { FilaDeAvaliacoes, rotuloDeData } from './FilaDeAvaliacoes';

const item = (o: Partial<ItemDaFila> = {}): ItemDaFila => ({
  id: 'id-1', salaoId: 'sal-1', salaoNome: 'Salão Aurora', nota: 4, nome: 'Maria S.', comentario: 'Bom',
  criadoEm: new Date('2026-11-20T23:30:00Z'), retiradaEm: null, pendentes: 0, motivos: [], naoPublicada: false, ...o,
});
const fila = (itens: ItemDaFila[], o: Partial<FilaModeracao> = {}): FilaModeracao => ({ total: itens.length, pagina: 1, porPagina: 20, itens, ...o });
const nul = { salaoId: null, estado: null, pagina: 1 } as const;

describe('rotuloDeData', () => {
  it('UTC rotulado, independente do fuso do processo', () => {
    expect(rotuloDeData(new Date('2026-11-20T23:30:00Z'))).toBe('20/11/2026 23:30 UTC');
  });
});

describe('FilaDeAvaliacoes', () => {
  it('lista cartões com situação, denúncias pendentes com motivos e links; comentário vira texto', () => {
    const { container } = render(
      <FilaDeAvaliacoes
        base="/admin/avaliacoes"
        hrefDoDetalhe={(id) => `/admin/avaliacoes/${id}`}
        filtros={nul}
        fila={fila([
          item({ pendentes: 2, motivos: ['ofensivo', 'spam'], comentario: '<b>x</b>' }),
          item({ id: 'id-2', retiradaEm: new Date('2026-11-21T10:00:00Z'), naoPublicada: true, nome: null, comentario: null, pendentes: 1, motivos: ['falso'] }),
        ])}
      />,
    );
    expect(screen.getByText('2 avaliações')).toBeTruthy();
    expect(container.querySelector('b')).toBeNull();
    expect(container.textContent).toContain('<b>x</b>');
    expect(screen.getByText(/2 denúncias pendentes: Linguagem ofensiva, Propaganda ou spam/)).toBeTruthy();
    expect(screen.getByText(/1 denúncia pendente: Conteúdo falso ou enganoso/)).toBeTruthy();
    expect(screen.getByText('Retirada em 21/11/2026 10:00 UTC')).toBeTruthy();
    expect(screen.getByText(/Não publicada/)).toBeTruthy();
    expect(screen.getByText(/Cliente removida/)).toBeTruthy();
    expect(screen.getAllByRole('link', { name: /Moderar avaliação/ }).map((a) => a.getAttribute('href'))).toEqual(['/admin/avaliacoes/id-1', '/admin/avaliacoes/id-2']);
    expect(screen.getAllByRole('link', { name: /Só este salão: / })[0].getAttribute('href')).toBe('/admin/avaliacoes?salao=sal-1');
    expect(container.textContent).not.toMatch(/telefone|@/);
  });

  it('filtro de salão ativo: campo oculto, link para limpar e sem "Só este salão"; vazio mostra mensagem', () => {
    const { container } = render(
      <FilaDeAvaliacoes base="/admin/avaliacoes" hrefDoDetalhe={(i) => i} filtros={{ salaoId: 'sal-1', estado: 'retirada', pagina: 1 }} fila={fila([])} />,
    );
    expect((container.querySelector('input[name="salao"]') as HTMLInputElement).value).toBe('sal-1');
    expect(screen.getByRole('link', { name: 'Mostrar todos os salões' }).getAttribute('href')).toBe('/admin/avaliacoes?estado=retirada');
    expect(screen.getByText('Nenhuma avaliação com esses filtros.')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Só este salão/ })).toBeNull();
    expect((screen.getByLabelText('Estado') as HTMLSelectElement).value).toBe('retirada');
    expect(screen.getByText('0 avaliações neste salão')).toBeTruthy();
  });

  it('paginação preserva os filtros e some quando há uma página só', () => {
    const f = { salaoId: 's', estado: 'visivel', pagina: 2 } as const;
    const { rerender } = render(<FilaDeAvaliacoes base="/b" hrefDoDetalhe={(i) => i} filtros={f} fila={fila([item()], { total: 45, pagina: 2 })} />);
    const nav = screen.getByRole('navigation', { name: 'Paginação' });
    expect(within(nav).getByText('Página 2 de 3')).toBeTruthy();
    expect(within(nav).getByRole('link', { name: 'Anterior' }).getAttribute('href')).toBe('/b?salao=s&estado=visivel');
    expect(within(nav).getByRole('link', { name: 'Próxima' }).getAttribute('href')).toBe('/b?salao=s&estado=visivel&pagina=3');
    rerender(<FilaDeAvaliacoes base="/b" hrefDoDetalhe={(i) => i} filtros={nul} fila={fila([item()], { total: 1 })} />);
    expect(screen.queryByRole('navigation', { name: 'Paginação' })).toBeNull();
    expect(screen.getByText('1 avaliação')).toBeTruthy();
  });
});

const detalhe = (o: Partial<DetalheDaAvaliacao> = {}): DetalheDaAvaliacao => ({
  id: 'av-1', salaoId: 's', salaoNome: 'Salão Aurora', nota: 1, nome: 'Maria S.', comentario: 'Ruim', criadoEm: new Date('2026-11-20T10:00:00Z'),
  retiradaEm: null, naoPublicada: false,
  denuncias: [
    { id: 'd1', motivo: 'ofensivo', texto: '<i>detalhe</i>', criadoEm: new Date('2026-11-21T10:00:00Z'), resolvidaEm: null, resolucao: null },
    { id: 'd2', motivo: 'spam', texto: null, criadoEm: new Date('2026-11-21T11:00:00Z'), resolvidaEm: null, resolucao: null },
    { id: 'd3', motivo: 'falso', texto: null, criadoEm: new Date('2026-11-19T11:00:00Z'), resolvidaEm: new Date('2026-11-20T08:00:00Z'), resolucao: 'retirada' },
    { id: 'd4', motivo: 'outro', texto: null, criadoEm: new Date('2026-11-18T11:00:00Z'), resolvidaEm: new Date('2026-11-20T08:00:00Z'), resolucao: 'mantida' },
  ],
  ...o,
});
const acoes = () => ({ retirar: vi.fn(async () => {}), restaurar: vi.fn(async () => {}), arquivar: vi.fn(async () => {}) });

describe('DetalheDaModeracao', () => {
  it('visível: formulário de retirar com aviso de dados pessoais; arquivar uma e todas; denúncias como texto', () => {
    const { container } = render(<DetalheDaModeracao detalhe={detalhe()} acoes={acoes()} resultado={null} hrefDaFila="/admin/avaliacoes" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Moderar avaliação' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retirar avaliação' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Restaurar avaliação' })).toBeNull();
    expect(screen.getByLabelText(/Motivo da moderação/)).toBeTruthy();
    expect(screen.getByText(/Não coloque dados pessoais/)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Arquivar esta denúncia' })).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Arquivar todas as pendentes (2)' })).toBeTruthy();
    expect(screen.getByText(/Resolvida com a retirada/)).toBeTruthy();
    expect(screen.getByText(/Arquivada, avaliação mantida/)).toBeTruthy();
    expect(container.querySelector('i')).toBeNull();
    expect(container.textContent).toContain('<i>detalhe</i>');
    expect(container.querySelectorAll('input[name="avaliacao_id"]').length).toBeGreaterThan(0);
    expect(container.textContent).not.toContain('Cliente removida');
  });

  it('retirada: formulário de restaurar; resultado vira alerta; sem pendentes não mostra "todas"', () => {
    render(
      <DetalheDaModeracao
        detalhe={detalhe({ retiradaEm: new Date('2026-11-21T12:00:00Z'), nome: null, naoPublicada: true, denuncias: [] })}
        acoes={acoes()}
        resultado="motivo_dados"
        hrefDaFila="/f"
      />,
    );
    expect(screen.getByRole('button', { name: 'Restaurar avaliação' })).toBeTruthy();
    expect(screen.getByText(/Retirada da página pública em 21\/11\/2026 12:00 UTC/)).toBeTruthy();
    expect(screen.getByText('Nenhuma denúncia.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Arquivar/ })).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('não pode conter e-mail nem telefone');
    expect(screen.getByText('Cliente removida', { exact: false })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Voltar à fila' }).getAttribute('href')).toBe('/f');
  });
});
