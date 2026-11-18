import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    // fileURLToPath (e não URL.pathname) para o caminho com espaço e acento não virar %20/%C3%81.
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    setupFiles: ['./vitest.setup.ts'],
    // Na 5.1.1 a opção não é aceita por projeto (R-2); fica na raiz para o projeto
    // integration terminar com código 0 enquanto não houver testes de banco (RN-6).
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      // Com include definido, arquivos de src/ não importados por testes entram com 0%.
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        // Os próprios testes não são código de produção.
        'src/**/*.test.{ts,tsx}',
        // Arquivos só de tipos não têm linhas executáveis.
        'src/**/*.d.ts',
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
        },
      },
    ],
  },
});
