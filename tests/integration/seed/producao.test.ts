import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { buildSync } from 'esbuild';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { recusarProducao } from '../../../prisma/seed';
import { urlDoWorker } from '../../support/db';
import { conectar } from '../../support/sql';

// D-036 CA-4: o CLI recusa NODE_ENV=production sem SEED_PERMITIR_PRODUCAO=true e não grava nada; com a flag
// roda. O CLI real (bundle esbuild como o de produção) em processo filho, contra a base vazia deste arquivo.

let c: pg.Client;
let dir: string;
let bundle: string;

function cli(env: Record<string, string>) {
  return spawnSync(process.execPath, [bundle], {
    env: {
      PATH: process.env.PATH ?? '',
      DATABASE_URL: urlDoWorker(),
      ARMAZENAMENTO_DIR: join(dir, 'armazenamento'),
      STORAGE_ADAPTER: 'simulado',
      APP_URL: 'http://localhost:3000',
      // Exigidas pelo schema de ambiente quando NODE_ENV=production (como no container).
      ADMIN_TOTP_CHAVE: 'Y29tcG9zZS1sb2NhbC1jaGF2ZS10b3RwLTAxMjM0NTY=',
      AVALIACAO_SEGREDO: 'segredo-de-teste-do-seed-com-32-caracteres-ou-mais',
      RATE_LIMIT_SEGREDO: 'segredo-de-teste-do-seed-com-32-caracteres-ou-mais',
      ...env,
    } as unknown as NodeJS.ProcessEnv,
    encoding: 'utf8',
  });
}
const salaos = async () => Number((await c.query('SELECT count(*) FROM salao')).rows[0].count);

beforeAll(async () => {
  c = await conectar();
  // O bundle fica dentro do repositório (node_modules/.cache) para os pacotes externos serem resolvidos.
  const cache = join(process.cwd(), 'node_modules', '.cache');
  mkdirSync(cache, { recursive: true });
  dir = mkdtempSync(join(cache, 'seed-cli-'));
  bundle = join(dir, 'seed.mjs');
  buildSync({
    entryPoints: [join(process.cwd(), 'prisma/seed.ts')],
    outfile: bundle,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    packages: 'external',
    logLevel: 'silent',
  });
}, 60_000);
afterAll(async () => {
  rmSync(dir, { recursive: true, force: true });
  await c.end();
});

describe('recusarProducao', () => {
  it('só recusa production sem a flag exata', () => {
    expect(() => recusarProducao({ NODE_ENV: 'production' })).toThrow(/SEED_PERMITIR_PRODUCAO/);
    expect(() => recusarProducao({ NODE_ENV: 'production', SEED_PERMITIR_PRODUCAO: '1' })).toThrow();
    expect(() => recusarProducao({ NODE_ENV: 'production', SEED_PERMITIR_PRODUCAO: 'true' })).not.toThrow();
    expect(() => recusarProducao({ NODE_ENV: 'development' })).not.toThrow();
    expect(() => recusarProducao({})).not.toThrow();
  });
});

describe('CLI do seed', () => {
  it('NODE_ENV=production sem a flag: sai com erro e não grava nada', async () => {
    const r = cli({ NODE_ENV: 'production' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('SEED_PERMITIR_PRODUCAO');
    expect(await salaos()).toBe(0);
  });

  it('sem DATABASE_URL: falha nomeando a variável', () => {
    const r = cli({ DATABASE_URL: '' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('DATABASE_URL');
  });

  it('com a flag roda; sem production também roda e a repetição não duplica', async () => {
    const a = cli({ NODE_ENV: 'production', SEED_PERMITIR_PRODUCAO: 'true' });
    expect(a.status, a.stderr).toBe(0);
    expect(await salaos()).toBe(2);
    const b = cli({});
    expect(b.status, b.stderr).toBe(0);
    expect(await salaos()).toBe(2);
  });
});
