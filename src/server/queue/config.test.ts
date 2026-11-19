import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { validarEnv } from '@/server/env';

import { APLICACAO_FILA, opcoesPgBoss, POOL_FILA, politicaDeRetry, SCHEMA_FILA } from './config';

const ler = (relativo: string) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(relativo, import.meta.url)), 'utf8'));
const pacote = ler('../../../package.json');
const lock = ler('../../../package-lock.json');

const URL_BANCO = 'postgresql://agenda:segredo@localhost:5432/agenda';

describe('CA-5 (D-008): versão fixada do pg-boss e do peer OpenTelemetry', () => {
  it.each([
    ['pg-boss', '12.38.0'],
    ['@opentelemetry/api', '1.10.0'],
  ])('%s está em dependencies com versão exata %s, igual à do lock', (nome, versao) => {
    expect(pacote.dependencies[nome]).toBe(versao);
    expect(pacote.devDependencies?.[nome]).toBeUndefined();
    expect(lock.packages[''].dependencies[nome]).toBe(versao);
    expect(lock.packages[`node_modules/${nome}`].version).toBe(versao);
    expect(lock.packages[`node_modules/${nome}`].dev).toBeUndefined();
  });

  it('nenhuma dependência usa ^ ou ~', () => {
    for (const grupo of [pacote.dependencies, pacote.devDependencies]) {
      for (const [nome, versao] of Object.entries<string>(grupo)) expect(versao, nome).toMatch(/^\d/);
    }
  });
});

describe('opcoesPgBoss', () => {
  it('usa o schema pgboss, o pool e o application_name de cada papel', () => {
    expect(SCHEMA_FILA).toBe('pgboss');
    expect(POOL_FILA).toEqual({ worker: 4, app: 2, instalador: 1 });
    for (const papel of ['worker', 'app', 'instalador'] as const) {
      expect(opcoesPgBoss(URL_BANCO, papel)).toMatchObject({
        connectionString: URL_BANCO,
        schema: 'pgboss',
        max: POOL_FILA[papel],
        application_name: APLICACAO_FILA[papel],
      });
    }
  });

  it('D-6: só o worker migra, supervisiona, agenda e se registra', () => {
    expect(opcoesPgBoss(URL_BANCO, 'worker')).toMatchObject({
      migrate: true,
      supervise: true,
      schedule: true,
      registerInstance: true,
      instanceName: 'worker',
    });
    expect(opcoesPgBoss(URL_BANCO, 'app')).toMatchObject({
      migrate: false,
      supervise: false,
      schedule: false,
      registerInstance: false,
    });
    expect(opcoesPgBoss(URL_BANCO, 'instalador')).toMatchObject({
      migrate: true,
      supervise: false,
      schedule: false,
      registerInstance: false,
    });
  });
});

describe('politicaDeRetry (RN-9)', () => {
  it('lê os padrões do ambiente validado', () => {
    expect(politicaDeRetry(validarEnv({ DATABASE_URL: URL_BANCO }))).toEqual({
      retryLimit: 4,
      retryDelay: 30,
      retryBackoff: true,
    });
  });

  it('reflete as variáveis QUEUE_RETRY_*', () => {
    const env = validarEnv({
      DATABASE_URL: URL_BANCO,
      QUEUE_RETRY_LIMIT: '3',
      QUEUE_RETRY_DELAY_SECONDS: '7',
      QUEUE_RETRY_BACKOFF: 'false',
    });
    expect(politicaDeRetry(env)).toEqual({ retryLimit: 3, retryDelay: 7, retryBackoff: false });
  });
});
