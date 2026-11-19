import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// CA-22 (RN-1, RN-16): o eslint.config.mjs do projeto impede, fora de src/server/integrations/**,
// tests/** e **/*.test.{ts,tsx}:
//   (a) importar nodemailer e SDKs de provedor;
//   (b) importar diretamente os adaptadores integrations/*/real e integrations/*/simulado (exceção:
//       src/app/dev/** pode usar o MP simulado);
//   (c) literais com os hosts dos provedores.
// Também prova que a reestruturação em blocos disjuntos não afrouxou a RN-10 da D-005 (R-1).
// Usa a configuração real (nada aqui redefine as regras) e arquivos simulados (filePath não precisa
// existir), no padrão de importacao-prisma.test.ts.

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const eslint = new ESLint({ cwd: RAIZ });
const TIMEOUT_MS = 60_000;

const REGRAS = ['no-restricted-imports', 'no-restricted-syntax'];

async function errosDaRegra(arquivo: string, codigo: string): Promise<string[]> {
  const [resultado] = await eslint.lintText(`${codigo}\n`, {
    filePath: path.join(RAIZ, arquivo),
    warnIgnored: true,
  });
  // Um arquivo ignorado pelo ESLint viraria "sem erros" por engano: falha explicitamente.
  const ignorado = resultado.messages.some((m) => m.ruleId === null && /ignored/i.test(m.message));
  if (ignorado) throw new Error(`${arquivo} está ignorado pelo ESLint`);
  return resultado.messages
    .filter((m) => m.ruleId !== null && REGRAS.includes(m.ruleId))
    .map((m) => `${m.ruleId}: ${m.message}`);
}

function casos(
  arquivos: string[],
  codigos: string[],
  verificar: (erros: string[], codigo: string) => void,
  rotulo: string,
) {
  for (const arquivo of arquivos) {
    for (const codigo of codigos) {
      it(
        `${rotulo}: ${arquivo} com \`${codigo}\``,
        async () => verificar(await errosDaRegra(arquivo, codigo), codigo),
        TIMEOUT_MS,
      );
    }
  }
}

function umErroRn16(regra: string) {
  return (erros: string[]) => {
    expect(erros).toHaveLength(1);
    expect(erros[0]).toMatch(new RegExp(`^${regra}: .*RN-16`));
  };
}

const SEM_ERRO = (erros: string[], codigo: string) => expect(erros, codigo).toEqual([]);

const SDKS = [
  "import nodemailer from 'nodemailer';",
  "import { createTransport } from 'nodemailer';",
  "import SMTPTransport from 'nodemailer/lib/smtp-transport';",
  "import { MercadoPagoConfig } from 'mercadopago';",
  "import x from '@mercadopago/sdk-react';",
  "import x from '@cloudflare/turnstile';",
  "import x from 'cloudflare';",
  "import x from 'whatsapp';",
  "import x from '@whatsapp/cloud-api';",
  "import x from '@meta/graph';",
  "export { createTransport } from 'nodemailer';",
];

const ADAPTADORES = [
  "import { x } from '@/server/integrations/mercadopago/simulado';",
  "import { x } from '@/server/integrations/mercadopago/real';",
  "import { x } from '@/server/integrations/mercadopago/checkout-simulado';",
  "import { x } from '@/server/integrations/email/real';",
  "import { x } from '@/server/integrations/email/simulado';",
  "import { x } from '@/server/integrations/turnstile/real.ts';",
  "import { x } from '@/server/integrations/whatsapp/simulado';",
  "import type { X } from '@/server/integrations/email/real';",
  "export { x } from '@/server/integrations/email/real';",
];

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const HOSTS = [
  `export const u = '${SITEVERIFY}';`,
  `export const u = \`${SITEVERIFY}\`;`,
  'export const u = `https://api.mercadopago.com/preapproval/${"x"}`;',
  "export const u = 'https://graph.facebook.com/v21.0/123/messages';",
  "fetch('https://api.mercadopago.com/v1/payments');",
];

const PERMITIDOS = [
  "import { obterIntegracoes } from '@/server/integrations/registry';",
  "import type { PortaEmail } from '@/server/integrations/email/port';",
  "import { validarEmail } from '@/server/integrations/email/port';",
  "import { lerConfigReal } from '@/server/integrations/turnstile/ambiente';",
  "import { x } from '@/server/integrations/realidade';",
  "import { x } from '@/server/integrations/mercadopago/simulador-ui';",
  "import x from 'pg-format';",
  "export const u = 'https://cloudflare.com/sobre';",
];

describe('lint: SDKs, adaptadores e hosts de provedor só em src/server/integrations (CA-22)', () => {
  // RN-16 (a): SDKs de provedor.
  casos(
    ['src/server/x.ts', 'src/app/x.ts', 'src/app/x.tsx', 'src/server/tenant/x.ts'],
    SDKS,
    umErroRn16('no-restricted-imports'),
    'CA-22 (a) erro',
  );
  casos(
    ['src/server/repos/x.ts', 'src/worker/x.ts', 'prisma/seed.ts', 'src/app/dev/mp-checkout/page.tsx'],
    ["import nodemailer from 'nodemailer';", "import { MercadoPagoConfig } from 'mercadopago';"],
    umErroRn16('no-restricted-imports'),
    'CA-22 (a) erro também nas pastas com permissões próprias',
  );

  // RN-16 (b): adaptadores importados diretamente.
  casos(['src/app/x.ts', 'src/server/x.ts'], ADAPTADORES, umErroRn16('no-restricted-imports'), 'CA-22 (b) erro');
  casos(
    ['src/server/repos/x.ts', 'src/worker/x.ts', 'prisma/seed.ts'],
    [
      "import { x } from '@/server/integrations/email/simulado';",
      "import { x } from '@/server/integrations/mercadopago/simulado';",
    ],
    umErroRn16('no-restricted-imports'),
    'CA-22 (b) erro nos repositórios, no worker e no seed',
  );
  casos(
    ['src/app/x.ts'],
    [
      "import { x } from '../server/integrations/email/real';",
      "import { x } from '../server/integrations/mercadopago/simulado.ts';",
    ],
    umErroRn16('no-restricted-imports'),
    'CA-22 (b) erro por caminho relativo',
  );
  casos(
    ['src/worker/x.ts'],
    ["import { x } from '../server/integrations/whatsapp/real';"],
    umErroRn16('no-restricted-imports'),
    'CA-22 (b) erro por caminho relativo',
  );

  // Exceção de src/app/dev/**: só o MP simulado (e o checkout simulado).
  casos(
    ['src/app/dev/mp-checkout/page.tsx', 'src/app/dev/mp-checkout/decisao/route.ts'],
    [
      "import { x } from '@/server/integrations/mercadopago/simulado';",
      "import { x } from '@/server/integrations/mercadopago/checkout-simulado';",
      "import { x } from '../../../server/integrations/mercadopago/simulado';",
      "import { obterIntegracoes } from '@/server/integrations/registry';",
    ],
    SEM_ERRO,
    'CA-22 (b) sem erro na exceção de dev',
  );
  casos(
    ['src/app/dev/mp-checkout/page.tsx'],
    [
      "import { x } from '@/server/integrations/mercadopago/real';",
      "import { x } from '@/server/integrations/email/real';",
      "import { x } from '@/server/integrations/email/simulado';",
      "import { x } from '@/server/integrations/whatsapp/simulado';",
      "import { x } from '@/server/integrations/turnstile/simulado';",
    ],
    umErroRn16('no-restricted-imports'),
    'CA-22 (b) erro em dev fora da exceção do MP simulado',
  );
  casos(
    ['src/app/dev/mp-checkout/page.tsx'],
    ["import { obterPrisma } from '@/server/repos/db';", "import pg from 'pg';"],
    (erros) => {
      expect(erros).toHaveLength(1);
      expect(erros[0]).toMatch(/^no-restricted-imports: .*RN-10/);
    },
    'RN-10 continua valendo em dev',
  );

  // RN-16 (c): hosts de provedor em literais (string e template).
  casos(
    ['src/app/x.ts', 'src/server/x.ts', 'src/worker/x.ts', 'src/app/dev/mp-checkout/page.tsx'],
    HOSTS,
    umErroRn16('no-restricted-syntax'),
    'CA-22 (c) erro',
  );

  // R-1: as integrações acessam o banco só via repos (a RN-10 continua valendo dentro delas).
  casos(
    ['src/server/integrations/x.ts', 'src/server/integrations/email/simulado.ts'],
    [
      "import { PrismaClient } from '@/generated/prisma/client';",
      "import { obterPrisma } from '@/server/repos/db';",
      "import { Pool } from 'pg';",
      "import { PrismaPg } from '@prisma/adapter-pg';",
    ],
    (erros) => {
      expect(erros).toHaveLength(1);
      expect(erros[0]).toMatch(/^no-restricted-imports: .*RN-10/);
    },
    'R-1 erro',
  );

  // Liberados.
  casos(
    ['src/server/integrations/email/real.ts', 'src/server/integrations/x.ts'],
    [
      ...SDKS,
      `export const u = '${SITEVERIFY}';`,
      `export const u = \`${SITEVERIFY}\`;`,
      "import { x } from './simulado';",
      "import { x } from '@/server/integrations/mercadopago/checkout-simulado';",
      "import { gravarEmail } from '@/server/repos/email-log';",
      "import type { PrismaClient } from '@/generated/prisma/client';",
    ],
    SEM_ERRO,
    'CA-22 sem erro dentro de integrations',
  );
  casos(
    ['tests/x.test.ts', 'tests/support/stubs/http.ts', 'src/app/x.test.ts', 'src/server/integrations/email/real.test.ts'],
    [...SDKS.slice(0, 2), ...ADAPTADORES.slice(0, 4), HOSTS[0], HOSTS[1]],
    SEM_ERRO,
    'CA-22 sem erro em testes',
  );
  casos(
    ['src/app/x.ts', 'src/server/x.ts', 'src/worker/x.ts'],
    PERMITIDOS,
    SEM_ERRO,
    'CA-22 sem erro com a porta, o registro e nomes parecidos',
  );

  it(
    'CA-22: o lint inteiro falha (errorCount > 0) para um arquivo de src/app que importa nodemailer',
    async () => {
      const [resultado] = await eslint.lintText(
        "import nodemailer from 'nodemailer';\n\nexport const n = nodemailer;\n",
        { filePath: path.join(RAIZ, 'src/app/viola.ts') },
      );
      expect(resultado.errorCount).toBeGreaterThan(0);
    },
    TIMEOUT_MS,
  );

  it(
    'CA-22: o auxiliar falha se o arquivo simulado estiver ignorado pelo ESLint',
    async () => {
      await expect(errosDaRegra('dist/worker/main.js', "import x from 'nodemailer';")).rejects.toThrow(
        /dist\/worker\/main\.js está ignorado pelo ESLint/,
      );
      await expect(
        errosDaRegra('src/generated/prisma/client.ts', "import x from 'nodemailer';"),
      ).rejects.toThrow(/ignorado/);
    },
    TIMEOUT_MS,
  );
});
