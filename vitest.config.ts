import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Carrega o .env local (DATABASE_URL, TEST_DATABASE_URL...) para os processos de teste.
// Variáveis já definidas no ambiente (CI) prevalecem: loadEnvFile não as sobrescreve.
// Só o erro de arquivo inexistente é ignorado.
try {
  process.loadEnvFile(fileURLToPath(new URL('./.env', import.meta.url)));
} catch (erro) {
  if ((erro as NodeJS.ErrnoException).code !== 'ENOENT') throw erro;
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    // fileURLToPath (e não URL.pathname) para o caminho com espaço e acento não virar %20/%C3%81.
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      // Com include definido, arquivos de src/ não importados por testes entram com 0%.
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        // Os próprios testes não são código de produção.
        'src/**/*.test.{ts,tsx}',
        // Arquivos só de tipos não têm linhas executáveis.
        'src/**/*.d.ts',
        // Cliente Prisma gerado por `npm run db:generate` (código gerado, não escrito à mão).
        'src/generated/**',
      ],
      thresholds: { lines: 90 },
      reporter: ['text', 'html', 'lcov', 'json-summary'],
      reportsDirectory: 'coverage',
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          // *.test.tsx declaram /** @vitest-environment jsdom */ no topo do arquivo.
          include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          environment: 'node',
          include: ['tests/integration/**/*.test.ts'],
          // Só aqui (não no projeto unit, que segue sem banco). Harness da D-005 (tests/support/):
          // o globalSetup cria o template da execução (migrate deploy + inicializadores de schema) e o
          // teardown apaga as bases da execução; o setupFiles recria a base do worker no início de cada
          // arquivo e aponta DATABASE_URL do processo de teste para ela.
          globalSetup: ['./tests/support/global-setup.ts'],
          setupFiles: ['./tests/support/setup-arquivo.ts'],
          // 4 workers × (pool 16 + 2) ≈ 72 conexões de 100 (docs/demandas/D-005/dba.md §2.4).
          maxWorkers: 4,
          fileParallelism: true,
          // maxWorkers diferente do projeto unit exige um grupo próprio (o Vitest recusa projetos com
          // maxWorkers distintos no mesmo groupOrder): o unit roda primeiro, depois o integration.
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
});
