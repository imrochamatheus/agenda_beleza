import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  // RN-10 (D-005): o acesso ao banco passa pelos repositórios. Fora das pastas liberadas, é proibido
  // importar o cliente Prisma gerado, @prisma/client, @prisma/adapter-pg, pg e o módulo da instância
  // (src/server/repos/db), inclusive por caminho relativo. `import type` é permitido (S-6): não abre
  // conexão nem permite consultar.
  {
    files: ['**/*.{ts,tsx,mts,js,mjs}'],
    ignores: [
      'src/server/repos/**',
      'src/worker/**',
      'prisma/seed.ts',
      'tests/**',
      '**/*.test.{ts,tsx}',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '(^|/)generated/prisma(/|$)',
              allowTypeImports: true,
              message: 'Acesse o banco pelos repositórios de src/server/repos (RN-10).',
            },
            {
              regex: '^@prisma/(client|adapter-pg)(/|$)',
              allowTypeImports: true,
              message: 'Acesse o banco pelos repositórios de src/server/repos (RN-10).',
            },
            {
              regex: '^pg(/|$)',
              allowTypeImports: true,
              message: 'Acesse o banco pelos repositórios de src/server/repos (RN-10).',
            },
            {
              regex: '(^|/)repos/db(\\.[cm]?[jt]s)?$',
              allowTypeImports: true,
              message: 'A instância do Prisma só é usada dentro de src/server/repos (RN-10).',
            },
          ],
        },
      ],
    },
  },
  // Artefatos gerados (node_modules já é ignorado por padrão).
  globalIgnores([
    '.next/**',
    'out/**',
    'coverage/**',
    'playwright-report/**',
    'test-results/**',
    'blob-report/**',
    'next-env.d.ts',
    // Cliente Prisma gerado por `npm run db:generate` (não é código escrito à mão).
    'src/generated/**',
    // Bundles do worker e do check-env gerados por `npm run build:node`.
    'dist/**',
  ]),
]);
