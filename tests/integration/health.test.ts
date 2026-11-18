import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { GET } from '@/app/api/health/route';
import { encerrarPrisma, obterPrisma } from '@/server/db';
import { verificarBanco } from '@/server/health';

import { urlBancoDeTeste } from './support/banco';

describe('GET /api/health com PostgreSQL real (CA-9)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    await encerrarPrisma();
  });

  it('responde 200 com {"status":"ok"} quando o SELECT 1 funciona', async () => {
    // A rota lê DATABASE_URL; aqui ela aponta para a base de teste, nunca para a de desenvolvimento.
    vi.stubEnv('DATABASE_URL', urlBancoDeTeste());
    const resposta = await GET();
    expect(resposta.status).toBe(200);
    expect(resposta.headers.get('cache-control')).toBe('no-store');
    expect(await resposta.json()).toEqual({ status: 'ok' });
  });

  it('verificarBanco devolve true contra o banco real', async () => {
    await expect(verificarBanco(obterPrisma(urlBancoDeTeste()))).resolves.toBe(true);
  });
});
