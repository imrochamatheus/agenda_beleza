import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { GET } from '@/app/api/health/route';
import { verificarBanco } from '@/server/health';
import { encerrarPrisma, obterPrisma } from '@/server/repos/db';
import { bancoDisponivel } from '@/server/repos/saude';

import { urlDoWorker } from '../support/db';

describe('GET /api/health com PostgreSQL real (CA-9)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    await encerrarPrisma();
  });

  it('responde 200 com {"status":"ok"} quando o SELECT 1 funciona', async () => {
    // A rota lê DATABASE_URL; o setup do arquivo já a aponta para a base do worker (nunca a de dev).
    expect(process.env.DATABASE_URL).toBe(urlDoWorker());
    const resposta = await GET();
    expect(resposta.status).toBe(200);
    expect(resposta.headers.get('cache-control')).toBe('no-store');
    expect(await resposta.json()).toEqual({ status: 'ok' });
  });

  it('verificarBanco devolve true contra o banco real', async () => {
    await expect(verificarBanco(obterPrisma(urlDoWorker()))).resolves.toBe(true);
  });

  it('bancoDisponivel devolve true contra o banco real', async () => {
    expect(process.env.DATABASE_URL).toBe(urlDoWorker());
    await expect(bancoDisponivel()).resolves.toBe(true);
  });
});
