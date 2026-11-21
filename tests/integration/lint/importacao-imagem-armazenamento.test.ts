import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// D-021 T-3 (A-9): `sharp` só em src/server/imagem/** (e testes); `@aws-sdk/*` só em
// src/server/integrations/**. Usa a configuração real e arquivos simulados.

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const eslint = new ESLint({ cwd: RAIZ });
const TIMEOUT_MS = 60_000;

async function erros(arquivo: string, codigo: string): Promise<string[]> {
  const [resultado] = await eslint.lintText(`${codigo}\n`, { filePath: path.join(RAIZ, arquivo), warnIgnored: true });
  return resultado.messages.filter((m) => m.ruleId === 'no-restricted-imports').map((m) => m.message);
}

const FORA = [
  'src/server/fotos/x.ts',
  'src/server/repos/x.ts',
  'src/server/integrations/armazenamento/x.ts',
  'src/server/queue/x.ts',
  'src/worker/x.ts',
  'src/app/x.tsx',
  'src/app/dev/x.ts',
  'src/lib/x.ts',
];

describe('lint: sharp só em src/server/imagem (A-9)', () => {
  for (const arquivo of FORA) {
    it(`barra sharp em ${arquivo}`, async () => {
      const e = await erros(arquivo, "import sharp from 'sharp';");
      expect(e).toHaveLength(1);
      expect(e[0]).toMatch(/src\/server\/imagem/);
    }, TIMEOUT_MS);
  }
  it('permite sharp em src/server/imagem e nos testes, mas a imagem continua sem Prisma e sem SDKs', async () => {
    expect(await erros('src/server/imagem/x.ts', "import sharp from 'sharp';")).toEqual([]);
    expect(await erros('tests/support/x.ts', "import sharp from 'sharp';")).toEqual([]);
    expect(await erros('src/server/imagem/x.ts', "import { S3Client } from '@aws-sdk/client-s3';")).toHaveLength(1);
    expect(await erros('src/server/imagem/x.ts', "import x from '@/generated/prisma/client';")).toHaveLength(1);
  }, TIMEOUT_MS);
});

describe('lint: @aws-sdk só em src/server/integrations (RN-16)', () => {
  for (const arquivo of [...FORA.filter((f) => !f.includes('integrations')), 'src/server/imagem/x.ts']) {
    it(`barra @aws-sdk/client-s3 em ${arquivo}`, async () => {
      expect(await erros(arquivo, "import { S3Client } from '@aws-sdk/client-s3';")).toHaveLength(1);
    }, TIMEOUT_MS);
  }
  it('permite em src/server/integrations e barra o import direto do adaptador de armazenamento', async () => {
    expect(await erros('src/server/integrations/armazenamento/real.ts', "import { S3Client } from '@aws-sdk/client-s3';")).toEqual([]);
    for (const alvo of ['@/server/integrations/armazenamento/real', '@/server/integrations/armazenamento/simulado']) {
      expect(await erros('src/server/fotos/x.ts', `import x from '${alvo}';`)).toHaveLength(1);
    }
  }, TIMEOUT_MS);
});
