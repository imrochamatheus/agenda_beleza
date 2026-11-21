/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import DemonstracaoAgenda, { dynamic, generateMetadata } from './page';
import { vistaDemonstracao } from './demonstracao';

// D-028 T-5: /dev/agenda só com a vitrine ligada; agenda, filtro, detalhe e 404 dos parâmetros.

afterEach(() => {
  vi.unstubAllEnvs();
});

async function renderizar(params: Record<string, string | string[]> = {}) {
  render(await DemonstracaoAgenda({ searchParams: Promise.resolve(params) }));
}

describe('página /dev/agenda', () => {
  it('force-dynamic; metadados noindex só com a vitrine ligada', () => {
    expect(dynamic).toBe('force-dynamic');
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    expect(generateMetadata()).toEqual({ title: 'Agenda (demonstração) · Agenda Beleza', robots: { index: false, follow: false } });
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
    await expect(DemonstracaoAgenda({ searchParams })).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' });
    expect(lidos).not.toHaveBeenCalled();
  });

  it('ligada: agenda do dia com navegação para a própria vitrine', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    await renderizar();
    expect(screen.getByRole('heading', { level: 1, name: 'Agenda' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Próximo dia' }).getAttribute('href')).toMatch(/^\/dev\/agenda\?data=\d{4}-\d{2}-\d{2}&visao=dia$/);
    expect(screen.getByRole('link', { name: /Maria Souza/ }).getAttribute('href')).toBe('/dev/agenda?reserva=demo-r1');
  });

  it('semana e filtro; parâmetro repetido vale como ausente', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    await renderizar({ visao: 'semana', profissional: 'demo-ana' });
    expect(screen.getByRole('link', { name: 'Semana anterior' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /Bia Demonstração/ })).toBeNull();
  });

  it('detalhe por ?reserva=; id desconhecido e profissional desconhecido → 404', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    await renderizar({ reserva: 'demo-r1' });
    expect(screen.getByRole('heading', { level: 1, name: 'Reserva' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Voltar para a agenda' }).getAttribute('href')).toBe('/dev/agenda');
    await expect(DemonstracaoAgenda({ searchParams: Promise.resolve({ reserva: 'x' }) })).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' });
    await expect(DemonstracaoAgenda({ searchParams: Promise.resolve({ profissional: 'x' }) })).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' });
  });

  it('vistaDemonstracao com profissional desconhecido devolve null', () => {
    expect(vistaDemonstracao({ profissional: 'x' }, new Date())).toBeNull();
  });
});
