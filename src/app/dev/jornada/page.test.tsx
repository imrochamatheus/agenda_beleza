/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MENSAGENS_JORNADA } from '@/server/jornadas/tipos';

import DemonstracaoJornada, { dynamic, generateMetadata } from './page';

// D-015 T-7: /dev/jornada só com a vitrine ligada; os três modos (D-11).

const M = MENSAGENS_JORNADA;

afterEach(() => {
  vi.unstubAllEnvs();
});

async function renderizar(params: Record<string, string | string[]> = {}) {
  render(await DemonstracaoJornada({ searchParams: Promise.resolve(params) }));
}

describe('página /dev/jornada', () => {
  it('force-dynamic; metadados noindex só com a vitrine ligada', () => {
    expect(dynamic).toBe('force-dynamic');
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    expect(generateMetadata()).toEqual({ title: 'Jornada (demonstração) · Agenda Beleza', robots: { index: false, follow: false } });
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
    await expect(DemonstracaoJornada({ searchParams })).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' });
    expect(lidos).not.toHaveBeenCalled();
  });

  it.each([[{}], [{ modo: 'edicao' }], [{ modo: 'desconhecido' }], [{ modo: ['leitura', 'vazia'] }]])(
    'edição (padrão, %j): formulário do gestor com a semana da fábrica',
    async (params) => {
      vi.stubEnv('VITRINE_COMPONENTES', 'true');
      await renderizar(params);
      expect(screen.getByRole('heading', { level: 1, name: 'Jornada de Ana Demonstração' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Salvar jornada' })).toBeTruthy();
      expect(document.querySelectorAll('details')).toHaveLength(7);
      expect(document.querySelector('details summary')!.textContent).toContain('09:00–12:00, 13:00–18:00 · Pausa 12:00–13:00');
      const nav = screen.getByRole('navigation', { name: 'Navegação do painel', hidden: true });
      expect(nav.querySelector('[aria-current="page"]')!.textContent).toBe('Profissionais');
    },
  );

  it('leitura: visão somente leitura do profissional, sem campos', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('VITRINE_COMPONENTES', undefined);
    await renderizar({ modo: 'leitura' });
    expect(screen.getByText(M.somenteLeitura)).toBeTruthy();
    expect(document.querySelector('main input, main button')).toBeNull();
    expect(screen.getAllByText('Folga')).toHaveLength(1);
    expect(screen.queryByText(M.semIntervalos)).toBeNull();
  });

  it('vazia: aviso de sem horários e tudo como folga', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    await renderizar({ modo: 'vazia' });
    expect(screen.getByText(M.semIntervalos)).toBeTruthy();
    expect(screen.getAllByText('Folga')).toHaveLength(7);
  });
});
