/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import DemonstracaoReserva, { dynamic, generateMetadata } from './page';

afterEach(() => {
  vi.unstubAllEnvs();
});

const renderizar = async (params: Record<string, string> = {}) => render(await DemonstracaoReserva({ searchParams: Promise.resolve(params) }));

describe('página /dev/reserva (CA-12)', () => {
  it('force-dynamic; metadados noindex só com a vitrine ligada', () => {
    expect(dynamic).toBe('force-dynamic');
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    expect(generateMetadata()).toEqual({ title: 'Reserva (demonstração) · Agenda Beleza', robots: { index: false, follow: false } });
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITRINE_COMPONENTES', 'false');
    expect(generateMetadata()).toEqual({});
  });

  it('desligada: 404 sem ler os parâmetros', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITRINE_COMPONENTES', 'false');
    const lidos = vi.fn();
    const searchParams = {
      then: (resolver: (v: unknown) => void) => {
        lidos();
        resolver({});
      },
    } as unknown as Promise<Record<string, string>>;
    await expect(DemonstracaoReserva({ searchParams })).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' });
    expect(lidos).not.toHaveBeenCalled();
  });

  it('ligada: perfil de exemplo e passo de serviços; vistas indisponível e vazia', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    const { unmount } = await renderizar();
    expect(screen.getByRole('heading', { level: 1, name: /Studio Bela/ })).toBeTruthy();
    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
    unmount();
    const indisponivel = await renderizar({ vista: 'indisponivel' });
    expect(screen.getByText('Agendamento indisponível')).toBeTruthy();
    expect(indisponivel.container.querySelector('form')).toBeNull();
    indisponivel.unmount();
    const vazio = await renderizar({ vista: 'vazio' });
    expect(vazio.container.textContent).not.toMatch(/undefined|null/);
    expect(screen.queryByRole('heading', { name: 'Endereço' })).toBeNull();
  });
});
