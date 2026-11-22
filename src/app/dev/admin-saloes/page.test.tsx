/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import DemonstracaoSaloes, { dynamic, generateMetadata } from './page';

vi.mock('next/navigation', async (orig) => ({ ...(await orig<object>()), usePathname: () => '/dev/admin-saloes' }));
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});
const renderizar = async (p: Record<string, string> = {}) => render(await DemonstracaoSaloes({ searchParams: Promise.resolve(p) }));
const links = () => screen.queryAllByRole('link', { name: /^Abrir / });

describe('/dev/admin-saloes', () => {
  it('force-dynamic; metadados só com a vitrine ligada; desligada → 404', async () => {
    expect(dynamic).toBe('force-dynamic');
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    expect(generateMetadata()).toMatchObject({ robots: { index: false, follow: false } });
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITRINE_COMPONENTES', 'false');
    expect(generateMetadata()).toEqual({});
    await expect(renderizar()).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' });
  });

  it('lista: 23 salões, 20 na primeira página; filtros e vazio', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    await renderizar();
    expect(screen.getByText('23 salões')).toBeTruthy();
    expect(links()).toHaveLength(20);
    cleanup();
    await renderizar({ pagina: '2' });
    expect(links()).toHaveLength(3);
    cleanup();
    await renderizar({ suspenso: 'sim' });
    expect(links()).toHaveLength(2);
    cleanup();
    await renderizar({ estado: 'sem_assinatura', q: 'DEMONSTRAÇÃO' });
    expect(links().length).toBeGreaterThan(0);
    cleanup();
    await renderizar({ estado: 'ativa', suspenso: 'nao' });
    expect(links().length).toBeGreaterThan(0);
    cleanup();
    await renderizar({ q: 'zzz' });
    expect(screen.getByRole('heading', { name: 'Nenhum salão encontrado.' })).toBeTruthy();
  });

  it('detalhe e suas vistas', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    await renderizar({ vista: 'detalhe' });
    expect(screen.getByRole('heading', { level: 1, name: 'Studio Aurora' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ver novo fim' })).toBeTruthy();
    cleanup();
    await renderizar({ vista: 'detalhe-sem-assinatura' });
    expect(screen.getByText('Este salão não tem assinatura.')).toBeTruthy();
  });
});
