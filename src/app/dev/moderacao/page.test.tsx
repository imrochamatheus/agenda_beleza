/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import DemonstracaoModeracao, { dynamic, generateMetadata } from './page';

afterEach(() => {
  vi.unstubAllEnvs();
});

const props = (q: Record<string, string> = {}) => ({ searchParams: Promise.resolve(q) });

describe('página /dev/moderacao', () => {
  it('force-dynamic; metadados noindex só com a vitrine ligada', () => {
    expect(dynamic).toBe('force-dynamic');
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    expect(generateMetadata()).toEqual({ title: 'Moderação (demonstração) · Agenda Beleza', robots: { index: false, follow: false } });
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITRINE_COMPONENTES', 'false');
    expect(generateMetadata()).toEqual({});
  });

  it.each([undefined, '', 'false', 'TRUE'])('desligada (VITRINE_COMPONENTES=%s) → 404', async (valor) => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITRINE_COMPONENTES', valor);
    await expect(DemonstracaoModeracao(props())).rejects.toThrow();
  });

  it('ligada: a fila filtra em memória por estado e salão; ?vista=detalhe mostra o detalhe com o resultado', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    const { rerender } = render(await DemonstracaoModeracao(props()));
    expect(screen.getAllByRole('link', { name: /Moderar avaliação/ })).toHaveLength(3);
    rerender(await DemonstracaoModeracao(props({ estado: 'retirada' })));
    expect(screen.getAllByRole('link', { name: /Moderar avaliação/ })).toHaveLength(1);
    rerender(await DemonstracaoModeracao(props({ estado: 'visivel' })));
    expect(screen.getAllByRole('link', { name: /Moderar avaliação/ })).toHaveLength(2);
    rerender(await DemonstracaoModeracao(props({ estado: 'com_denuncia_pendente', salao: '33333333-3333-4333-8333-333333333333' })));
    expect(screen.getAllByRole('link', { name: /Moderar avaliação/ })).toHaveLength(2);
    rerender(await DemonstracaoModeracao(props({ vista: 'detalhe', resultado: 'retirada' })));
    expect(screen.getByRole('heading', { level: 1, name: 'Moderar avaliação' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('Avaliação retirada');
  });
});
