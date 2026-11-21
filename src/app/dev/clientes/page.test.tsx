/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import DemonstracaoClientes, { dynamic, generateMetadata } from './page';

// D-022 T-6: /dev/clientes só com a vitrine ligada; lista com busca e paginação em memória; detalhe; anonimizada.

afterEach(() => {
  vi.unstubAllEnvs();
});

async function renderizar(params: Record<string, string | string[]> = {}) {
  render(await DemonstracaoClientes({ searchParams: Promise.resolve(params) }));
}
const nomesDaLista = () => Array.from(document.querySelectorAll('main li > a')).map((a) => a.textContent);

describe('página /dev/clientes', () => {
  it('force-dynamic; metadados noindex só com a vitrine ligada', () => {
    expect(dynamic).toBe('force-dynamic');
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    expect(generateMetadata()).toEqual({ title: 'Clientes (demonstração) · Agenda Beleza', robots: { index: false, follow: false } });
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITRINE_COMPONENTES', 'false');
    expect(generateMetadata()).toEqual({});
  });

  it.each([undefined, '', 'false', 'TRUE'])('desligada (VITRINE_COMPONENTES=%s) → 404 sem ler os parâmetros', async (valor) => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITRINE_COMPONENTES', valor);
    const lidos = vi.fn();
    const searchParams = {
      then: (resolver: (v: unknown) => void) => {
        lidos();
        resolver({});
      },
    } as unknown as Promise<Record<string, string>>;
    await expect(DemonstracaoClientes({ searchParams })).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' });
    expect(lidos).not.toHaveBeenCalled();
  });

  it('lista: 25 clientes, primeira página com 20 ordenados sem acento; Próxima aponta para a página 2', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    await renderizar();
    expect(screen.getByRole('heading', { level: 1, name: 'Clientes' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('25 clientes · página 1 de 2');
    const nomes = nomesDaLista();
    expect(nomes.slice(0, 2)).toEqual(['ANA CLARA', 'Ana Júlia']);
    expect(nomes).toHaveLength(20);
    expect(screen.getByRole('link', { name: 'Próxima' }).getAttribute('href')).toBe('/dev/clientes?pagina=2');
  });

  it('página 2 tem 5 clientes; página inválida cai na 1', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    await renderizar({ pagina: '2' });
    expect(nomesDaLista()).toHaveLength(5);
    expect(nomesDaLista().at(-1)).toBe('Zélia');
  });

  it('busca por nome sem acento, por dígitos do telefone, literais e sem resultado', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    await renderizar({ q: 'JULIA' });
    expect(nomesDaLista()).toEqual(['Ana Júlia']);
    document.body.innerHTML = '';
    await renderizar({ q: '(21) 99123' });
    expect(nomesDaLista()).toEqual(['ANA CLARA']);
    document.body.innerHTML = '';
    await renderizar({ q: '%' });
    expect(nomesDaLista()).toEqual(['João_%']);
    document.body.innerHTML = '';
    await renderizar({ q: 'xyz' });
    expect(screen.getByRole('heading', { name: 'Nenhuma cliente encontrada.' })).toBeTruthy();
  });

  it('vista=detalhe: formulário com os valores, histórico e link de volta', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    await renderizar({ vista: 'detalhe' });
    expect((screen.getByRole('textbox', { name: 'Nome' }) as HTMLInputElement).value).toBe('Maria Souza');
    expect((screen.getByLabelText('Telefone') as HTMLInputElement).value).toBe('(11) 98765-4321');
    expect(screen.getByRole('heading', { name: 'Agendamentos' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Voltar para clientes' }).getAttribute('href')).toBe('/dev/clientes');
  });

  it('vista=anonimizada: "Cliente removida", histórico e sem formulário de edição', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    await renderizar({ vista: 'anonimizada' });
    expect(screen.getByRole('heading', { level: 1, name: 'Cliente removida' })).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Agendamentos' })).toBeTruthy();
  });

  it('vista=excluir: confirmação com o nome, Confirmar e Cancelar de volta ao detalhe; o detalhe tem o link', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    await renderizar({ vista: 'excluir' });
    expect(screen.getByRole('heading', { level: 1, name: 'Excluir cliente' })).toBeTruthy();
    expect(screen.getByText('Maria Souza')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Confirmar exclusão' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Cancelar' }).getAttribute('href')).toBe('/dev/clientes?vista=detalhe');
    document.body.innerHTML = '';
    await renderizar({ vista: 'detalhe' });
    expect(screen.getByRole('link', { name: 'Excluir cliente' }).getAttribute('href')).toBe('/dev/clientes?vista=excluir');
  });

  it('vista=anonimizada com ?exclusao=ok mostra o aviso de sucesso; valor desconhecido não mostra', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    await renderizar({ vista: 'anonimizada', exclusao: 'ok' });
    expect(screen.getByRole('status').textContent).toContain('Cliente excluída');
    document.body.innerHTML = '';
    await renderizar({ vista: 'anonimizada', exclusao: 'x' });
    expect(screen.queryByRole('status')).toBeNull();
  });
});
