import { afterEach, describe, expect, it, vi } from 'vitest';

// Só os metadados (sem renderizar nem tocar no banco); a página inteira é testada contra o
// PostgreSQL real em tests/integration/integracoes/checkout.test.ts.
import { generateMetadata } from './page';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('/dev/mp-checkout: metadados (D-009 DEF-2)', () => {
  it.each([
    ['simulado', 'simulado'],
    ['ausente (padrão simulado)', undefined],
    ['vazio (padrão simulado)', ''],
  ])('modo %s: título e robots noindex/nofollow', (_r, valor) => {
    vi.stubEnv('MP_ADAPTER', valor);
    expect(generateMetadata()).toEqual({
      title: 'Checkout simulado · Agenda Beleza',
      robots: { index: false, follow: false },
    });
  });

  it.each(['real', 'x'])('MP_ADAPTER=%s (página 404): sem título nem robots próprios', (valor) => {
    vi.stubEnv('MP_ADAPTER', valor);
    expect(generateMetadata()).toEqual({});
  });
});
