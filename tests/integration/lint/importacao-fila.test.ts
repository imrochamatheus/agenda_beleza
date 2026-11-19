import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// CA-17 (D-008, D-8): o eslint.config.mjs do projeto só aceita importar o pg-boss em
// src/server/queue/**, src/worker/** e nos testes. As restrições da D-005 (Prisma) e da D-007 (SDKs e
// adaptadores) continuam valendo nas duas pastas novas. Usa a configuração real e arquivos simulados
// (filePath não precisa existir), no padrão de importacao-integracoes.test.ts.

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const eslint = new ESLint({ cwd: RAIZ });
const TIMEOUT_MS = 60_000;

async function erros(arquivo: string, codigo: string): Promise<string[]> {
  const [resultado] = await eslint.lintText(`${codigo}\n`, {
    filePath: path.join(RAIZ, arquivo),
    warnIgnored: true,
  });
  const ignorado = resultado.messages.some((m) => m.ruleId === null && /ignored/i.test(m.message));
  if (ignorado) throw new Error(`${arquivo} está ignorado pelo ESLint`);
  return resultado.messages
    .filter((m) => m.ruleId === 'no-restricted-imports')
    .map((m) => `${m.ruleId}: ${m.message}`);
}

function casos(arquivos: string[], codigos: string[], verificar: (e: string[], c: string) => void, rotulo: string) {
  for (const arquivo of arquivos) {
    for (const codigo of codigos) {
      it(`${rotulo}: ${arquivo} com \`${codigo}\``, async () => verificar(await erros(arquivo, codigo), codigo), TIMEOUT_MS);
    }
  }
}

const umErro = (marca: RegExp) => (e: string[]) => {
  expect(e).toHaveLength(1);
  expect(e[0]).toMatch(marca);
};
const SEM_ERRO = (e: string[], codigo: string) => expect(e, codigo).toEqual([]);

const PG_BOSS = [
  "import { PgBoss } from 'pg-boss';",
  "import type { ConstructorOptions } from 'pg-boss';",
  "import x from 'pg-boss/dist/index.js';",
  "export { PgBoss } from 'pg-boss';",
];

describe('lint: pg-boss só em src/server/queue e src/worker (CA-17)', () => {
  casos(
    [
      'src/server/tenant/x.ts',
      'src/app/x.ts',
      'src/app/x.tsx',
      'src/server/x.ts',
      'src/server/repos/x.ts',
      'src/server/integrations/x.ts',
      'src/app/dev/x.ts',
      'src/scripts/x.ts',
      'src/lib/x.ts',
      'prisma/seed.ts',
    ],
    PG_BOSS,
    umErro(/^no-restricted-imports: .*D-8/),
    'erro fora das pastas liberadas',
  );

  casos(
    ['src/server/queue/x.ts', 'src/worker/x.ts', 'src/worker/handlers/x.ts', 'tests/x.ts', 'src/server/x.test.ts'],
    PG_BOSS,
    SEM_ERRO,
    'aceito nas pastas liberadas e nos testes',
  );

  casos(
    ['src/worker/x.ts', 'src/server/queue/x.ts'],
    [
      "import nodemailer from 'nodemailer';",
      "import { x } from '@/server/integrations/email/real';",
      "import { x } from '@/server/integrations/mercadopago/simulado';",
    ],
    umErro(/^no-restricted-imports: .*RN-16/),
    'D-007 continua valendo',
  );

  casos(
    ['src/server/queue/x.ts'],
    [
      "import { PrismaClient } from '@/generated/prisma/client';",
      "import { obterPrisma } from '@/server/repos/db';",
      "import pg from 'pg';",
    ],
    umErro(/^no-restricted-imports: .*RN-10/),
    'D-005 (RN-10) vale na fila',
  );

  casos(
    ['src/worker/x.ts'],
    ["import { obterPrisma } from '@/server/repos/db';", "import pg from 'pg';"],
    SEM_ERRO,
    'o worker mantém o acesso ao banco de antes',
  );

  casos(
    ['src/server/x.ts', 'src/app/x.ts'],
    ["import { enfileirar } from '@/server/queue/client';", "import { FILA } from '@/server/queue/filas';"],
    SEM_ERRO,
    'o cliente de fila é importável pela app',
  );
});
