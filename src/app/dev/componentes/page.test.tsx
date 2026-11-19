/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import VitrineDeComponentes, { dynamic, generateMetadata } from './page';

afterEach(() => {
  vi.unstubAllEnvs();
});

const busca = (params: Record<string, string | string[]> = {}) => ({ searchParams: Promise.resolve(params) });

async function renderizar(params: Record<string, string | string[]> = {}) {
  render(await VitrineDeComponentes(busca(params)));
}

describe('página /dev/componentes (CA-18, RN-17)', () => {
  it('exporta force-dynamic; habilitada, os metadados têm título e robots noindex/nofollow', () => {
    expect(dynamic).toBe('force-dynamic');
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    const metadados = generateMetadata();
    expect(metadados.robots).toEqual({ index: false, follow: false });
    expect(metadados.title).toBe('Vitrine de componentes · Agenda Beleza');
  });

  it('em next dev os metadados também têm o título', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('VITRINE_COMPONENTES', undefined);
    expect(generateMetadata().title).toBe('Vitrine de componentes · Agenda Beleza');
  });

  it.each([undefined, '', 'false', '1', 'TRUE'])(
    'DEF-2: desligada (VITRINE_COMPONENTES=%s) não expõe título nem nada da vitrine',
    (valor) => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('VITRINE_COMPONENTES', valor);
      expect(generateMetadata()).toEqual({});
    },
  );

  it.each([
    ['ausente', undefined],
    ['vazia', ''],
    ['false', 'false'],
    ['1', '1'],
    ['TRUE', 'TRUE'],
  ])('production com a variável %s → notFound (404), sem ler os parâmetros', async (_r, valor) => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITRINE_COMPONENTES', valor);
    const lidos = vi.fn();
    const searchParams = {
      then: (resolver: (v: unknown) => void) => {
        lidos();
        resolver({});
      },
    } as unknown as Promise<Record<string, string>>;
    await expect(VitrineDeComponentes({ searchParams })).rejects.toMatchObject({
      digest: 'NEXT_HTTP_ERROR_FALLBACK;404',
    });
    expect(lidos).not.toHaveBeenCalled();
  });

  it('com VITRINE_COMPONENTES=true renderiza (layout público por padrão)', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    await renderizar();
    expect(screen.getByRole('heading', { level: 1, name: 'Vitrine de componentes' })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Acesso' })).toBeTruthy();
  });

  it('em next dev (NODE_ENV=development) renderiza sem a variável', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('VITRINE_COMPONENTES', undefined);
    await renderizar({ layout: 'publico-salao' });
    expect(screen.getByText('Salão Exemplo')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Entrar' })).toBeNull();
  });

  it('painel com papel e caminho', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    await renderizar({ layout: 'painel', papel: 'profissional', caminho: '/painel/agenda/nova' });
    const nav = screen.getByRole('navigation', { name: 'Navegação do painel', hidden: true });
    expect(nav.querySelectorAll('a')).toHaveLength(2);
    expect(nav.querySelector('[aria-current="page"]')!.textContent).toBe('Agenda');
  });

  it('admin', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    await renderizar({ layout: 'admin' });
    expect(screen.getByText('Administração da plataforma')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Navegação da administração', hidden: true })).toBeTruthy();
  });

  it('parâmetro desconhecido usa o padrão, sem erro', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    await renderizar({ layout: 'inexistente' });
    expect(screen.getByRole('navigation', { name: 'Acesso' })).toBeTruthy();
  });
});
