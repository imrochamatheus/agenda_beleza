// Prepara a base descartável do E2E (D-036): recria `<base>_e2e`, aplica as migrações, semeia os salões de
// demonstração e o complemento do E2E, e recria o diretório de fotos. Roda ANTES do Playwright (o webServer
// sobe antes do globalSetup, então não dá para criar o banco lá): `npm run test:e2e` e a CI chamam
// `node dist/e2e/preparar-banco.js`. `npx playwright test` isolado exige que isto tenha rodado antes.
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';

import pg from 'pg';

import { integracoes } from '@/server/integrations/registry';
import { encerrarPrisma } from '@/server/repos/db';

import { semear, semearComplementoE2E } from '../../prisma/seed';
import { ambienteDoServidorE2E, diretorioArmazenamentoE2E, urlDoBancoE2E } from './ambiente';

function identificador(nome: string): string {
  if (!/^[A-Za-z0-9_]{1,63}$/.test(nome)) throw new Error('Nome da base do E2E fora do formato esperado.');
  return `"${nome}"`;
}

async function recriarBanco(urlE2E: string): Promise<void> {
  const nome = new URL(urlE2E).pathname.replace(/^\//, '');
  // Conexão administrativa: a base `postgres` do mesmo servidor (o papel precisa de CREATEDB).
  const admin = new URL(urlE2E);
  admin.pathname = '/postgres';
  const cliente = new pg.Client({ connectionString: admin.toString() });
  await cliente.connect();
  try {
    await cliente.query(`DROP DATABASE IF EXISTS ${identificador(nome)} WITH (FORCE)`);
    await cliente.query(`CREATE DATABASE ${identificador(nome)}`);
  } finally {
    await cliente.end();
  }
}

function migrar(env: NodeJS.ProcessEnv): void {
  const r = spawnSync('npx', ['prisma', 'migrate', 'deploy'], { env, stdio: 'inherit' });
  if (r.status !== 0) throw new Error('prisma migrate deploy falhou na base do E2E.');
}

export async function main(): Promise<void> {
  const urlE2E = urlDoBancoE2E(process.env);
  const servidor = ambienteDoServidorE2E(process.env);
  const env: NodeJS.ProcessEnv = { ...process.env, ...servidor };
  const diretorio = diretorioArmazenamentoE2E();

  await recriarBanco(urlE2E);
  migrar(env);
  rmSync(diretorio, { recursive: true, force: true });
  mkdirSync(diretorio, { recursive: true });

  // Este processo usa as mesmas variáveis do servidor (banco, adaptadores simulados, diretório).
  Object.assign(process.env, servidor);
  try {
    const deps = { armazenamento: integracoes().armazenamento };
    await semear(deps);
    await semearComplementoE2E(deps);
  } finally {
    await encerrarPrisma();
  }
  console.log(`preparar-banco: base do E2E pronta (${new URL(urlE2E).pathname.slice(1)}).`);
}

main().catch((erro: unknown) => {
  console.error(`preparar-banco: falhou: ${erro instanceof Error ? erro.message : String(erro)}`);
  process.exit(1);
});
