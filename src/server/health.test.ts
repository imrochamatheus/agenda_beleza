import { afterEach, describe, expect, it } from 'vitest';

import { criarPrisma } from './db';
import { TIMEOUT_HEALTH_MS, verificarBanco } from './health';

// O caso "banco respondeu" com PostgreSQL real está em tests/integration/health.test.ts (CA-9).
describe('verificarBanco', () => {
  const clientes: { $disconnect(): Promise<void> }[] = [];

  afterEach(async () => {
    await Promise.all(clientes.splice(0).map((c) => c.$disconnect()));
  });

  it('usa timeout de 3 s, abaixo dos 5 s do healthcheck e do CA-5', () => {
    expect(TIMEOUT_HEALTH_MS).toBe(3000);
  });

  it('devolve false, sem lançar, quando a conexão real é recusada (porta fechada)', async () => {
    const prisma = criarPrisma('postgresql://x:y@127.0.0.1:1/z');
    clientes.push(prisma);
    await expect(verificarBanco(prisma)).resolves.toBe(false);
  });

  it('devolve false quando a consulta não responde dentro do timeout', async () => {
    // Stub do contrato de timeout (não é mock de banco): uma consulta que nunca resolve.
    const travado = { $queryRaw: () => new Promise<never>(() => {}) };
    const inicio = performance.now();
    await expect(verificarBanco(travado as never, 50)).resolves.toBe(false);
    expect(performance.now() - inicio).toBeLessThan(1000);
  });

  it('devolve false quando $queryRaw lança de forma síncrona', async () => {
    const quebrado = {
      $queryRaw: () => {
        throw new Error('falha');
      },
    };
    await expect(verificarBanco(quebrado as never, 50)).resolves.toBe(false);
  });
});
