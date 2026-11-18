import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

import { urlBancoDeTeste } from './banco';

// Raiz do repositório. fileURLToPath (e não URL.pathname): o caminho tem espaço e acento.
const RAIZ = fileURLToPath(new URL('../../..', import.meta.url));

/** Caminho absoluto do binário do Prisma CLI (node_modules/.bin/prisma), resolvido a partir da raiz do repo. */
export function binarioPrisma(): string {
  return join(RAIZ, 'node_modules', '.bin', 'prisma');
}

/**
 * Executa o Prisma CLI com DATABASE_URL = url (sobrescrita explícita). Sem shell: o caminho do
 * repositório tem espaço e acento. O prisma.config.ts usa process.loadEnvFile(), que não
 * sobrescreve variáveis já definidas, então a URL passada aqui prevalece sobre o .env.
 */
export function executarPrisma(
  args: string[],
  url: string,
): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(binarioPrisma(), args, {
    cwd: RAIZ,
    env: { ...process.env, DATABASE_URL: url },
    encoding: 'utf8',
  });
  if (r.error) throw r.error;
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/**
 * Recria o schema public da base de TEST_DATABASE_URL e aplica as migrações. Uma vez por execução
 * do projeto `integration` (RN-13). Proibido aqui: migrate reset, db push e TRUNCATE.
 */
export async function prepararBancoDeTeste(): Promise<void> {
  // 1. A guarda é a PRIMEIRA instrução: nada se conecta antes dela (RN-13a, CA-21).
  const url = urlBancoDeTeste();

  // 2. Reset por DROP SCHEMA, com a URL que a guarda devolveu. Os triggers append-only não
  //    disparam em DROP, então linhas antigas em auditoria não impedem o reset (CA-22).
  const cliente = new pg.Client({ connectionString: url });
  await cliente.connect();
  try {
    await cliente.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  } finally {
    await cliente.end();
  }

  // 3. Migrações do repositório, com DATABASE_URL sobrescrita pela URL de teste.
  const r = executarPrisma(['migrate', 'deploy'], url);
  if (r.status !== 0) {
    throw new Error(`prisma migrate deploy falhou (status ${r.status}):\n${r.stderr}\n${r.stdout}`);
  }
}
