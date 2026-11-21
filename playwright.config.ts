import { defineConfig } from '@playwright/test';

import { ambienteDoServidorE2E } from './e2e/suporte/ambiente';

// Lê o .env como o preparar-banco (variáveis já definidas no ambiente prevalecem).
import { existsSync } from 'node:fs';
if (existsSync('.env')) process.loadEnvFile('.env');

const baseURL = 'http://127.0.0.1:3000';

// Sem TEST_DATABASE_URL/E2E_DATABASE_URL (nem .env) os specs sem banco (/dev/*, /entrar...) continuam rodando: o
// servidor recebe uma URL inalcançável. Os specs com banco falham com mensagem clara em `urlDoBancoE2E`, e o
// `test:e2e` falha antes, no preparar-banco.
function ambienteDoServidor() {
  try {
    return ambienteDoServidorE2E(process.env);
  } catch {
    return ambienteDoServidorE2E({ ...process.env, E2E_DATABASE_URL: 'postgresql://sem-banco@127.0.0.1:1/sem_banco' });
  }
}

export default defineConfig({
  testDir: 'e2e',
  // Só *.spec.ts: os *.test.ts(x) do Vitest não são coletados.
  testMatch: '**/*.spec.ts',
  outputDir: 'test-results',
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  forbidOnly: !!process.env.CI,
  retries: 0,
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'mobile-chromium',
      use: {
        browserName: 'chromium',
        viewport: { width: 375, height: 812 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  // O build é feito pelo script test:e2e antes do Playwright; aqui só sobe o servidor.
  webServer: {
    command: 'npm run start',
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    // D-036: banco `<base>_e2e` preparado por dist/e2e/preparar-banco.js; limites PROTECAO_* altos só aqui.
    // VITRINE_COMPONENTES=true liga /dev/* (D-009 CA-18). Prevalece sobre o ambiente e o .env.
    env: ambienteDoServidor(),
  },
});
