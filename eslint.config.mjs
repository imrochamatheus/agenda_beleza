import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
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
