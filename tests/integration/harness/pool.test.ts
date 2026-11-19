import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { configurarPool, criarPrisma, obterPrisma } from '@/server/repos/db';

import { nomeDoWorker, POOL_MAX_TESTES, urlDoWorker } from '../../support/db';
import { conectar } from '../../support/sql';

type ClienteRaw = { $queryRawUnsafe<T = unknown>(sql: string): Promise<T> };

/**
 * Dispara `n` consultas `pg_sleep(segundos)` ao mesmo tempo pelo cliente e mede, por um observador
 * independente, o maior número de backends distintos ativos simultaneamente nessa consulta.
 */
async function medirParalelismo(
  cliente: ClienteRaw,
  n: number,
  segundos: number,
): Promise<{ maxAtivos: number; duracaoMs: number }> {
  const marca = `ca16_${randomUUID().replaceAll('-', '')}`;
  const observador = await conectar();
  let maxAtivos = 0;
  let rodando = true;
  const observar = (async () => {
    while (rodando) {
      const r = await observador.query<{ n: number }>(
        `SELECT count(DISTINCT pid)::int AS n FROM pg_stat_activity
         WHERE datname = $1 AND state = 'active' AND pid <> pg_backend_pid() AND query LIKE $2`,
        [nomeDoWorker(), `%${marca}%`],
      );
      maxAtivos = Math.max(maxAtivos, r.rows[0].n);
      await new Promise((ok) => setTimeout(ok, 50));
    }
  })();
  const inicio = Date.now();
  try {
    await Promise.all(
      Array.from({ length: n }, () => cliente.$queryRawUnsafe(`SELECT 1 AS ok FROM pg_sleep(${segundos}) /* ${marca} */`)),
    );
  } finally {
    rodando = false;
    await observar;
    await observador.end();
  }
  return { maxAtivos, duracaoMs: Date.now() - inicio };
}

describe('CA-16: o pool do harness não serializa requisições paralelas', () => {
  it('CA-16: o cliente padrão (obterPrisma) aponta para a base do worker', async () => {
    const r = await obterPrisma().$queryRawUnsafe<{ b: string }[]>('SELECT current_database() AS b');
    expect(r).toEqual([{ b: nomeDoWorker() }]);
  });

  it('CA-16: 12 pg_sleep(1) simultâneos via obterPrisma() ocupam 12 backends ativos ao mesmo tempo', async () => {
    expect(POOL_MAX_TESTES).toBeGreaterThanOrEqual(12);
    const { maxAtivos, duracaoMs } = await medirParalelismo(obterPrisma(), 12, 1);
    expect(maxAtivos).toBe(12);
    // Serializado em lotes, levaria ≥ 2 s; em paralelo, ~1 s.
    expect(duracaoMs).toBeLessThan(2000);
  }, 30_000);

  it('controle: com configurarPool({ max: 2 }) num cliente novo, no máximo 2 backends ficam ativos', async () => {
    configurarPool({ max: 2 });
    const cliente = criarPrisma(urlDoWorker());
    try {
      const { maxAtivos, duracaoMs } = await medirParalelismo(cliente, 12, 0.5);
      expect(maxAtivos).toBe(2);
      // 12 consultas em 6 lotes de 2: ≥ 3 s.
      expect(duracaoMs).toBeGreaterThanOrEqual(2900);
    } finally {
      configurarPool({ max: POOL_MAX_TESTES });
      await cliente.$disconnect();
    }
  }, 30_000);
});
