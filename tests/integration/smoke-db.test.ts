import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { nomeDoWorker, urlDoWorker } from '../support/db';

// Smoke de banco da CI (CA-3 da D-006): conexão direta, sem a camada HTTP, à base do worker indicada pelo
// harness. Nenhuma URL fixa e nenhuma escrita.
describe('smoke de banco: conexão e SELECT 1 (CA-3 da D-006)', () => {
  let cliente: pg.Client;

  beforeAll(async () => {
    // O setup do arquivo aponta DATABASE_URL para a base do worker (nunca a de desenvolvimento).
    expect(process.env.DATABASE_URL).toBe(urlDoWorker());
    cliente = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await cliente.connect();
  });

  afterAll(async () => {
    await cliente?.end();
  });

  it('SELECT 1 devolve 1', async () => {
    const { rows } = await cliente.query<{ um: number }>('SELECT 1 AS um');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.um).toBe(1);
  });

  it('está conectado à base deste worker (sufixo _w<N>)', async () => {
    const { rows } = await cliente.query<{ base: string }>('SELECT current_database() AS base');
    expect(rows[0]?.base).toBe(nomeDoWorker());
    expect(rows[0]?.base).toMatch(/_w\d{1,3}$/);
  });
});
