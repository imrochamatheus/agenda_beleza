/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import DemonstracaoReservaNova, { dynamic, generateMetadata } from './page';

// D-029: /dev/reserva-nova só com a vitrine ligada; modos gestor (seletor) e profissional (agenda própria).
afterEach(() => vi.unstubAllEnvs());

async function renderizar(params: Record<string, string | string[]> = {}) {
  render(await DemonstracaoReservaNova({ searchParams: Promise.resolve(params) }));
}

describe('página /dev/reserva-nova', () => {
  it('force-dynamic; metadados noindex só com a vitrine ligada', () => {
    expect(dynamic).toBe('force-dynamic');
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    expect(generateMetadata()).toEqual({ title: 'Nova reserva (demonstração) · Agenda Beleza', robots: { index: false, follow: false } });
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITRINE_COMPONENTES', 'false');
    expect(generateMetadata()).toEqual({});
  });

  it.each([undefined, '', 'false', 'TRUE'])('desligada (VITRINE_COMPONENTES=%s) → 404 sem ler os parâmetros', async (valor) => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITRINE_COMPONENTES', valor);
    const lidos = vi.fn();
    const searchParams = { then: (r: (v: unknown) => void) => { lidos(); r({}); } } as unknown as Promise<Record<string, string>>;
    await expect(DemonstracaoReservaNova({ searchParams })).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' });
    expect(lidos).not.toHaveBeenCalled();
  });

  it('gestor: seletor de profissional e serviços de exemplo', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    await renderizar({ hora: '09:30' });
    expect(screen.getByRole('heading', { level: 1, name: 'Nova reserva' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Profissional' })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: /Corte feminino/ })).toBeTruthy();
    expect((screen.getByLabelText(/Hora/) as HTMLInputElement).value).toBe('09:30');
  });

  it('modo profissional: sem seletor', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    await renderizar({ modo: 'profissional' });
    expect(screen.queryByRole('combobox', { name: 'Profissional' })).toBeNull();
    expect(screen.getByText('Ana Demonstração')).toBeTruthy();
  });
});
