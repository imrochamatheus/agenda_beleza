/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MENSAGEM_LINK_INVALIDO } from '@/server/avaliacoes/tipos';

import DemonstracaoAvaliacao, { dynamic, generateMetadata } from './page';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('página /dev/avaliacao', () => {
  it('force-dynamic; metadados noindex só com a vitrine ligada', () => {
    expect(dynamic).toBe('force-dynamic');
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    expect(generateMetadata()).toEqual({ title: 'Avaliação (demonstração) · Agenda Beleza', robots: { index: false, follow: false } });
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITRINE_COMPONENTES', 'false');
    expect(generateMetadata()).toEqual({});
  });

  it.each([undefined, '', 'false', 'TRUE'])('desligada (VITRINE_COMPONENTES=%s) → 404', async (valor) => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITRINE_COMPONENTES', valor);
    await expect(DemonstracaoAvaliacao({ searchParams: Promise.resolve({}) })).rejects.toThrow();
  });

  it('ligada mostra o formulário; ?vista=invalido mostra a resposta uniforme', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    const { unmount } = render(await DemonstracaoAvaliacao({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole('heading', { level: 1, name: 'Avalie Salão Demonstração' })).toBeTruthy();
    expect(screen.getAllByRole('radio')).toHaveLength(5);
    unmount();
    render(await DemonstracaoAvaliacao({ searchParams: Promise.resolve({ vista: 'invalido' }) }));
    expect(screen.getByRole('alert').textContent).toContain(MENSAGEM_LINK_INVALIDO);
  });
});
