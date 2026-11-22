/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import DemonstracaoConvite, { dynamic, generateMetadata } from './page';

afterEach(() => {
  vi.unstubAllEnvs();
});

const renderizar = async (params: Record<string, string> = {}) =>
  render(await DemonstracaoConvite({ searchParams: Promise.resolve(params) }));

describe('página /dev/convite', () => {
  it('force-dynamic; metadados noindex só com a vitrine ligada', () => {
    expect(dynamic).toBe('force-dynamic');
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    expect(generateMetadata()).toEqual({ title: 'Convite (demonstração) · Agenda Beleza', robots: { index: false, follow: false } });
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITRINE_COMPONENTES', 'false');
    expect(generateMetadata()).toEqual({});
  });

  it.each([undefined, '', 'false', 'TRUE'])('desligada (VITRINE_COMPONENTES=%s) → 404', async (valor) => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITRINE_COMPONENTES', valor);
    await expect(DemonstracaoConvite({ searchParams: Promise.resolve({}) })).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' });
  });

  it('ligada: formulário por padrão e recusa com ?vista=recusado', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    const { unmount } = await renderizar();
    expect(screen.getByRole('heading', { level: 1, name: 'Ativar o seu acesso' })).toBeTruthy();
    unmount();
    await renderizar({ vista: 'recusado' });
    expect(screen.getByRole('heading', { level: 1, name: 'Convite inválido' })).toBeTruthy();
    expect(document.querySelector('form')).toBeNull();
  });
});
