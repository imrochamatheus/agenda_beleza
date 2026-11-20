/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import DemonstracaoPerfil, { dynamic, generateMetadata } from './page';

// D-020 T-12: /dev/perfil só com a vitrine ligada; perfil de exemplo e `?vazio=1`.

afterEach(() => {
  vi.unstubAllEnvs();
});

const renderizar = async (params: Record<string, string> = {}) => render(await DemonstracaoPerfil({ searchParams: Promise.resolve(params) }));

describe('página /dev/perfil', () => {
  it('force-dynamic; metadados noindex só com a vitrine ligada', () => {
    expect(dynamic).toBe('force-dynamic');
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    expect(generateMetadata()).toEqual({ title: 'Perfil público (demonstração) · Agenda Beleza', robots: { index: false, follow: false } });
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITRINE_COMPONENTES', 'false');
    expect(generateMetadata()).toEqual({});
  });

  it('desligada → 404 sem ler os parâmetros', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITRINE_COMPONENTES', 'false');
    const lidos = vi.fn();
    const searchParams = {
      then: (resolver: (v: unknown) => void) => {
        lidos();
        resolver({});
      },
    } as unknown as Promise<Record<string, string>>;
    await expect(DemonstracaoPerfil({ searchParams })).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' });
    expect(lidos).not.toHaveBeenCalled();
  });

  it('ligada: perfil de exemplo preenchido; ?vazio=1 vazio', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    const { unmount } = await renderizar();
    expect(screen.getByRole('heading', { level: 1, name: 'Perfil público' })).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'Telefone' }) as HTMLInputElement).value).toBe('(11) 3456-7890');
    expect((screen.getByRole('textbox', { name: 'CEP' }) as HTMLInputElement).value).toBe('01304-001');
    expect((screen.getByRole('checkbox', { name: 'Pix' }) as HTMLInputElement).checked).toBe(true);
    unmount();
    await renderizar({ vazio: '1' });
    expect((screen.getByRole('textbox', { name: 'Telefone' }) as HTMLInputElement).value).toBe('');
    expect((screen.getByRole('checkbox', { name: 'Pix' }) as HTMLInputElement).checked).toBe(false);
  });
});
