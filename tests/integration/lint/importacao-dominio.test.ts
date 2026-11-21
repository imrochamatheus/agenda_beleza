import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// D-018 T-2 (A-1): o domínio puro (src/domain/**) só importa `@/server/tempo/fuso` de fora da pasta,
// não lê o relógio e não usa métodos de data em hora local. Usa a configuração real do ESLint.

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const eslint = new ESLint({ cwd: RAIZ });
const TIMEOUT_MS = 60_000;
const DOMINIO = 'src/domain/disponibilidade/x.ts';

async function mensagens(arquivo: string, codigo: string, regra: string): Promise<string[]> {
  const [resultado] = await eslint.lintText(`${codigo}\n`, { filePath: path.join(RAIZ, arquivo), warnIgnored: true });
  return resultado.messages.filter((m) => m.ruleId === regra).map((m) => m.message);
}
const importa = (arquivo: string, codigo: string) => mensagens(arquivo, codigo, 'no-restricted-imports');
const sintaxe = (arquivo: string, codigo: string) => mensagens(arquivo, codigo, 'no-restricted-syntax');

describe('lint: importações do domínio (A-1)', () => {
  const PROIBIDOS = [
    "import { repos } from '@/server/repos';",
    "import { x } from '@/server/tenant/context';",
    "import { headers } from 'next/headers';",
    "import React from 'react';",
    "import { PrismaClient } from '@/generated/prisma/client';",
    "import x from '@prisma/client';",
    "import PgBoss from 'pg-boss';",
    "import x from '../server/repos/db';",
    "import x from '@/app/x';",
    "import x from '@/components/ui/x';",
    "import x from '@/server/tempo/outro';",
    "import x from 'nodemailer';",
    "import x from '@/server/integrations/email/real';",
  ];
  for (const codigo of PROIBIDOS) {
    it(`barra: ${codigo}`, async () => {
      expect((await importa(DOMINIO, codigo)).length).toBeGreaterThanOrEqual(1);
    }, TIMEOUT_MS);
  }

  it('permite @/server/tempo/fuso e importações da própria pasta', async () => {
    expect(await importa(DOMINIO, "import { instanteDeHoraLocal } from '@/server/tempo/fuso';")).toEqual([]);
    expect(await importa(DOMINIO, "import type { DataCivil } from '@/server/tempo/fuso';")).toEqual([]);
    expect(await importa(DOMINIO, "import type { Intervalo } from './tipos';")).toEqual([]);
  }, TIMEOUT_MS);

  it('as regras gerais continuam valendo fora do domínio', async () => {
    expect(await importa('src/server/x.ts', "import x from '@/generated/prisma/client';")).toHaveLength(1);
    expect(await importa('src/server/x.ts', "import { instanteDeHoraLocal } from '@/server/tempo/fuso';")).toEqual([]);
    expect(await importa('src/server/disponibilidade/x.ts', "import x from '@/domain/disponibilidade';")).toEqual([]);
  }, TIMEOUT_MS);

  it('os testes do domínio ficam fora das regras de arquitetura', async () => {
    expect(await importa('src/domain/disponibilidade/x.test.ts', "import { repos } from '@/server/repos';")).toEqual([]);
  }, TIMEOUT_MS);
});

describe('lint: relógio e hora local no domínio (A-1)', () => {
  const PROIBIDOS = [
    'const a = Date.now();',
    'const a = new Date();',
    'const a = Date();',
    'const a = new Date(0).getDay();',
    'const a = new Date(0).getHours();',
    'const a = new Date(0).setHours(1);',
    'const a = new Date(0).getTimezoneOffset();',
    'const a = new Date(0).toLocaleString();',
  ];
  for (const codigo of PROIBIDOS) {
    it(`acusa: ${codigo}`, async () => {
      expect(await sintaxe(DOMINIO, codigo)).toHaveLength(1);
    }, TIMEOUT_MS);
  }

  it('aceita new Date(argumento), Date.UTC e os métodos getUTC*', async () => {
    expect(await sintaxe(DOMINIO, 'const a = new Date(0); const b = a.getUTCDay(); const c = Date.UTC(2026, 0, 1); const d = a.getTime();')).toEqual([]);
  }, TIMEOUT_MS);

  it('fora do domínio o relógio continua permitido', async () => {
    expect(await sintaxe('src/server/x.ts', 'const a = Date.now(); const b = new Date();')).toEqual([]);
  }, TIMEOUT_MS);

  it('a regra de hosts de provedor continua valendo no domínio', async () => {
    expect(await sintaxe(DOMINIO, "const a = 'https://api.mercadopago.com/x';")).toHaveLength(1);
  }, TIMEOUT_MS);
});
