import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// CA-5 (RN-10, S-6): a regra no-restricted-imports do eslint.config.mjs do projeto impede importar o
// cliente Prisma, o driver e a instância fora de src/server/repos/**, src/worker/**, prisma/seed.ts,
// tests/** e **/*.test.{ts,tsx}. Usa a configuração real (nada aqui redefine a regra) e arquivos
// simulados (filePath não precisa existir).

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const eslint = new ESLint({ cwd: RAIZ });
const TIMEOUT_MS = 60_000;

async function errosDaRegra(arquivo: string, codigo: string): Promise<string[]> {
  const [resultado] = await eslint.lintText(`${codigo}\n`, {
    filePath: path.join(RAIZ, arquivo),
    warnIgnored: true,
  });
  // Um arquivo ignorado pelo ESLint viraria "sem erros" por engano: falha explicitamente.
  const ignorado = resultado.messages.some((m) => m.ruleId === null && /ignored/i.test(m.message));
  if (ignorado) throw new Error(`${arquivo} está ignorado pelo ESLint`);
  return resultado.messages
    .filter((m) => m.ruleId === 'no-restricted-imports')
    .map((m) => m.message);
}

const IMPORTS_PROIBIDOS = [
  "import { PrismaClient } from '@/generated/prisma/client';",
  "import { Prisma } from '@/generated/prisma';",
  "import { PrismaClient } from '@prisma/client';",
  "import { PrismaPg } from '@prisma/adapter-pg';",
  "import pg from 'pg';",
  "import { Pool } from 'pg';",
  "import { obterPrisma } from '@/server/repos/db';",
  "export { obterPrisma } from '@/server/repos/db';",
];

// Relativos calculados a partir de cada arquivo simulado.
const RELATIVOS: Record<string, string[]> = {
  'src/app/x.ts': [
    "import { obterPrisma } from '../server/repos/db';",
    "import { PrismaClient } from '../generated/prisma/client';",
  ],
  'src/server/tenant/x.ts': [
    "import { obterPrisma } from '../repos/db';",
    "import { PrismaClient } from '../../generated/prisma/client';",
  ],
  'src/server/x.ts': ["import { obterPrisma } from './repos/db';"],
};

describe('lint: importação do cliente Prisma restrita aos repositórios (CA-5)', () => {
  for (const arquivo of ['src/app/x.ts', 'src/server/tenant/x.ts', 'src/server/x.ts']) {
    for (const codigo of [...IMPORTS_PROIBIDOS, ...RELATIVOS[arquivo]]) {
      it(
        `CA-5: ${arquivo} com \`${codigo}\` falha com no-restricted-imports`,
        async () => {
          const erros = await errosDaRegra(arquivo, codigo);
          expect(erros).toHaveLength(1);
          expect(erros[0]).toMatch(/RN-10/);
        },
        TIMEOUT_MS,
      );
    }
  }

  it(
    'CA-5: o lint inteiro falha (errorCount > 0) para um arquivo de src/app que importa o cliente',
    async () => {
      const [resultado] = await eslint.lintText(
        "import { obterPrisma } from '@/server/repos/db';\n\nexport const p = obterPrisma;\n",
        { filePath: path.join(RAIZ, 'src/app/viola.ts') },
      );
      expect(resultado.errorCount).toBeGreaterThan(0);
    },
    TIMEOUT_MS,
  );

  const LIBERADOS = [
    'src/server/repos/x.ts',
    'src/server/repos/sub/x.ts',
    'src/worker/x.ts',
    'prisma/seed.ts',
    'tests/x.test.ts',
    'tests/support/x.ts',
    'src/app/x.test.ts',
    'src/app/x.test.tsx',
  ];
  for (const arquivo of LIBERADOS) {
    it(
      `CA-5: ${arquivo} pode importar o cliente, o driver e a instância`,
      async () => {
        for (const codigo of IMPORTS_PROIBIDOS) {
          expect(await errosDaRegra(arquivo, codigo), codigo).toEqual([]);
        }
      },
      TIMEOUT_MS,
    );
  }

  it(
    'S-6: import type do cliente é permitido fora dos repositórios',
    async () => {
      const permitidos = [
        "import type { PrismaClient } from '@/generated/prisma/client';",
        "import { type PrismaClient } from '@/generated/prisma/client';",
        "import type pg from 'pg';",
        "import type { obterPrisma } from '@/server/repos/db';",
      ];
      for (const codigo of permitidos) {
        expect(await errosDaRegra('src/server/x.ts', codigo), codigo).toEqual([]);
      }
    },
    TIMEOUT_MS,
  );

  it(
    'não bloqueia módulos com nomes parecidos',
    async () => {
      const permitidos = [
        "import { verificarBanco } from '@/server/health';",
        "import { bancoDisponivel } from '@/server/repos/saude';",
        "import x from 'pg-format';",
        "import { defineConfig } from 'prisma/config';",
      ];
      for (const codigo of permitidos) {
        expect(await errosDaRegra('src/app/x.ts', codigo), codigo).toEqual([]);
      }
    },
    TIMEOUT_MS,
  );
});
