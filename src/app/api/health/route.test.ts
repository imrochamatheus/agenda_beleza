import { afterEach, describe, expect, it, vi } from 'vitest';

import { encerrarPrisma } from '@/server/db';

import { dynamic, GET } from './route';

// O caso 200 com PostgreSQL real está em tests/integration/health.test.ts (CA-9).
describe('GET /api/health', () => {
  afterEach(async () => {
    vi.unstubAllEnvs();
    await encerrarPrisma();
  });

  it('é dinâmica (nunca pré-renderizada no build)', () => {
    expect(dynamic).toBe('force-dynamic');
  });

  it('responde 503 em até 5 s com o PostgreSQL inacessível, sem detalhes no corpo (CA-5, RN-10)', async () => {
    // Conexão real a uma porta fechada: falha de verdade, sem mock de banco.
    vi.stubEnv('DATABASE_URL', 'postgresql://usuario:senha-secreta@127.0.0.1:1/z');
    const inicio = performance.now();
    const resposta = await GET();
    expect(performance.now() - inicio).toBeLessThan(5000);

    expect(resposta.status).toBe(503);
    expect(resposta.headers.get('cache-control')).toBe('no-store');
    expect(await resposta.text()).toBe('{"status":"indisponivel"}');
  });

  it('responde 503 sem DATABASE_URL', async () => {
    vi.stubEnv('DATABASE_URL', '');
    const resposta = await GET();
    expect(resposta.status).toBe(503);
    expect(await resposta.json()).toEqual({ status: 'indisponivel' });
  });
});
