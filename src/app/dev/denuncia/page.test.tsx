/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MENSAGENS_DENUNCIA } from '@/server/denuncias/tipos';

import DemonstracaoDenuncia, { dynamic, generateMetadata } from './page';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('página /dev/denuncia', () => {
  it('force-dynamic; metadados noindex só com a vitrine ligada', () => {
    expect(dynamic).toBe('force-dynamic');
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    expect(generateMetadata()).toEqual({ title: 'Denúncia (demonstração) · Agenda Beleza', robots: { index: false, follow: false } });
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITRINE_COMPONENTES', 'false');
    expect(generateMetadata()).toEqual({});
  });

  it.each([undefined, '', 'false', 'TRUE'])('desligada (VITRINE_COMPONENTES=%s) → 404', async (valor) => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITRINE_COMPONENTES', valor);
    await expect(DemonstracaoDenuncia({ searchParams: Promise.resolve({}) })).rejects.toThrow();
  });

  it('ligada: duas avaliações com formulário; ?denuncia=recebida mostra a resposta uniforme', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    const { container, rerender } = render(await DemonstracaoDenuncia({ searchParams: Promise.resolve({}) }));
    expect(container.querySelectorAll('details')).toHaveLength(2);
    expect(screen.queryByText(MENSAGENS_DENUNCIA.recebida)).toBeNull();
    rerender(await DemonstracaoDenuncia({ searchParams: Promise.resolve({ denuncia: 'recebida' }) }));
    expect(screen.getByText(MENSAGENS_DENUNCIA.recebida)).toBeTruthy();
  });
});
