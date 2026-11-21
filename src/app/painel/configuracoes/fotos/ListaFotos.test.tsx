/** @vitest-environment jsdom */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { FotoDoPainel } from '@/server/fotos/tipos';

import { resultadoDaAcao, resultadoDoEnvio, campoDoErro } from './estado';
import { ListaFotos } from './ListaFotos';

// D-021 T-9: CA-15/CA-16 na apresentação da lista.

const F = (n: number): FotoDoPainel => ({ id: `id-${n}`, posicao: n, alt: `Foto ${n}`, largura: 800, altura: 600 });
const acoes = () => ({ alt: vi.fn(async () => {}), mover: vi.fn(async () => {}), remover: vi.fn(async () => {}) });

describe('ListaFotos', () => {
  it('vazia: mostra a mensagem, sem lista', () => {
    render(<ListaFotos fotos={[]} acoes={acoes()} />);
    expect(screen.getByText('O salão ainda não tem fotos.')).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('cada foto tem miniatura com alt e dimensões, e botões com nome que identifica a foto', () => {
    render(<ListaFotos fotos={[F(1), F(2), F(3)]} acoes={acoes()} />);
    const itens = within(screen.getByRole('list', { name: 'Fotos do salão' })).getAllByRole('listitem');
    expect(itens).toHaveLength(3);
    const img = within(itens[1]).getByRole('img', { name: 'Foto 2' }) as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('/api/fotos/id-2');
    expect([img.width, img.height]).toEqual([800, 600]);
    expect(within(itens[2]).getByRole('button', { name: 'Remover a foto 3' })).toBeTruthy();
    expect(within(itens[2]).getByRole('button', { name: 'Mover para cima: foto 3' })).toBeTruthy();
    expect(within(itens[2]).getByRole('button', { name: 'Salvar descrição da foto 3' })).toBeTruthy();
    expect((within(itens[1]).getByLabelText('Descrição da foto 2') as HTMLInputElement).value).toBe('Foto 2');
    expect(within(itens[0]).getByText('Foto 1 de 3')).toBeTruthy();
  });

  it('os botões das pontas são aria-disabled (focáveis) e os do meio não', () => {
    render(<ListaFotos fotos={[F(1), F(2), F(3)]} acoes={acoes()} />);
    expect(screen.getByRole('button', { name: 'Mover para cima: foto 1' }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('button', { name: 'Mover para baixo: foto 3' }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('button', { name: 'Mover para cima: foto 2' }).getAttribute('aria-disabled')).toBeNull();
    expect(screen.getByRole('button', { name: 'Mover para baixo: foto 1' }).getAttribute('aria-disabled')).toBeNull();
  });

  it('cada formulário leva o id, a posição esperada e a direção como campos ocultos', () => {
    const { container } = render(<ListaFotos fotos={[F(1), F(2)]} acoes={acoes()} urlDe={(f) => `data:x/${f.id}`} />);
    const cima = [...container.querySelectorAll('form')].find((f) => (f.querySelector('input[name="direcao"]') as HTMLInputElement | null)?.value === 'cima' && (f.querySelector('input[name="fotoId"]') as HTMLInputElement).value === 'id-2')!;
    expect((cima.querySelector('input[name="posicaoEsperada"]') as HTMLInputElement).value).toBe('2');
    expect(container.querySelector('img')!.getAttribute('src')).toBe('data:x/id-1');
  });
});

describe('estado.ts', () => {
  it('traduz códigos em mensagem e variante; erros de campo vs. geral', () => {
    expect(resultadoDoEnvio('ok').variante).toBe('sucesso');
    expect(resultadoDoEnvio('limite')).toMatchObject({ variante: 'erro' });
    expect(resultadoDaAcao('movida').variante).toBe('sucesso');
    expect(resultadoDaAcao('ordem_mudou').variante).toBe('aviso');
    expect(resultadoDaAcao('nao_encontrada').variante).toBe('erro');
    expect(campoDoErro('tamanho')).toBe('foto');
    expect(campoDoErro('alt_vazio')).toBe('alt');
    expect(campoDoErro('limite')).toBeNull();
    expect(campoDoErro(null)).toBeNull();
  });
});
