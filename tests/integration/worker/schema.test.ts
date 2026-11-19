import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import pg from 'pg';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { opcoesPgBoss } from '@/server/queue/config';

import { nomesDaExecucao, novoExec, urlComBase, validarPlanoDeBases } from '../../support/banco';
import { apagarBasesDaExecucao, filaPgBoss, INICIALIZADORES, prepararTemplate, urlDoWorker } from '../../support/db';

// CA-6 (D-008, RN-1, RN-7): o template do harness já traz o schema `pgboss` na versão da dependência
// fixada, sem filas, e o start() do worker numa cópia não aplica migração nem cria nada em `public`.

const VERSAO_SCHEMA: number = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../node_modules/pg-boss/package.json', import.meta.url)), 'utf8'),
).pgboss.schema;

let c: pg.Client;

beforeAll(async () => {
  c = new pg.Client({ connectionString: urlDoWorker() });
  await c.connect();
});

afterAll(async () => {
  await c.end();
});

async function tabelas(schema: string): Promise<string[]> {
  const r = await c.query<{ t: string }>(
    `SELECT table_name AS t FROM information_schema.tables WHERE table_schema = $1 ORDER BY 1`,
    [schema],
  );
  return r.rows.map((x) => x.t);
}

async function versao(): Promise<number> {
  const r = await c.query<{ version: number }>('SELECT version FROM pgboss.version');
  return Number(r.rows[0].version);
}

describe('schema pgboss no template (CA-6)', () => {
  it('o inicializador do pg-boss está registrado depois do schema de prova', () => {
    expect(INICIALIZADORES.map((i) => i.nome)).toEqual(['schema-de-prova', 'pgboss']);
  });

  it('a base do worker do Vitest já tem o schema pgboss na versão do pacote fixado e nenhuma fila', async () => {
    const ns = await c.query("SELECT 1 FROM pg_namespace WHERE nspname = 'pgboss'");
    expect(ns.rowCount).toBe(1);
    expect(VERSAO_SCHEMA).toBe(46);
    expect(await versao()).toBe(VERSAO_SCHEMA);
    const filas = await c.query('SELECT count(*)::int AS n FROM pgboss.queue');
    expect(filas.rows[0].n).toBe(0);
  });

  it('o start() do worker numa base copiada do template não migra pgboss nem cria tabelas em public', async () => {
    const publicAntes = await tabelas('public');
    const pgbossAntes = await tabelas('pgboss');
    const boss = new PgBoss(opcoesPgBoss(urlDoWorker(), 'worker'));
    boss.on('error', () => undefined);
    try {
      await boss.start();
      expect(await boss.schemaVersion()).toBe(VERSAO_SCHEMA);
    } finally {
      await boss.stop({ graceful: false, close: true });
    }
    expect(await versao()).toBe(VERSAO_SCHEMA);
    expect(await tabelas('pgboss')).toEqual(pgbossAntes);
    expect(await tabelas('public')).toEqual(publicAntes);
    expect(publicAntes.some((t) => /job|queue|schedule|pgboss/i.test(t))).toBe(false);
  }, 30_000);

  it('o preparo de um template só com o inicializador do pg-boss termina sem sessões abertas (A-9)', async () => {
    const atual = inject('bancoDeTeste');
    const plano = { ...validarPlanoDeBases({ TEST_DATABASE_URL: atual.urlTeste }, novoExec(), 1), baseDev: atual.baseDev };
    const nomes = nomesDaExecucao(plano.base, plano.exec);
    try {
      // prepararTemplate falharia nomeando harness:pgboss se o inicializador deixasse sessão aberta.
      await prepararTemplate(plano, [filaPgBoss]);
      const admin = new pg.Client({ connectionString: plano.urlTeste });
      await admin.connect();
      try {
        await admin.query(
          `CREATE DATABASE ${admin.escapeIdentifier(nomes.worker(1))} TEMPLATE ${admin.escapeIdentifier(nomes.template)}`,
        );
      } finally {
        await admin.end();
      }
      const w = new pg.Client({ connectionString: urlComBase(plano.urlTeste, nomes.worker(1)) });
      await w.connect();
      try {
        const r = await w.query<{ version: number }>('SELECT version FROM pgboss.version');
        expect(Number(r.rows[0].version)).toBe(VERSAO_SCHEMA);
      } finally {
        await w.end();
      }
    } finally {
      await apagarBasesDaExecucao(plano);
    }
  }, 120_000);
});
