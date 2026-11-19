import { afterEach, describe, expect, it, vi } from 'vitest';

import { encerrarPrisma } from './db';
import { bancoDisponivel } from './saude';

// O caso true com PostgreSQL real está em tests/integration/health.test.ts.
describe('bancoDisponivel', () => {
  afterEach(async () => {
    vi.unstubAllEnvs();
    await encerrarPrisma();
  });

  it('devolve false com o PostgreSQL inacessível (porta fechada, conexão real)', async () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://usuario:senha@127.0.0.1:1/z');
    await expect(bancoDisponivel()).resolves.toBe(false);
  });

  it('devolve false sem DATABASE_URL, sem lançar', async () => {
    vi.stubEnv('DATABASE_URL', '');
    await expect(bancoDisponivel()).resolves.toBe(false);
  });
});
