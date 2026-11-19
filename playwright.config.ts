import { defineConfig } from '@playwright/test';

const baseURL = 'http://127.0.0.1:3000';

export default defineConfig({
  testDir: 'e2e',
  // Só *.spec.ts: os *.test.ts(x) do Vitest não são coletados.
  testMatch: '**/*.spec.ts',
  outputDir: 'test-results',
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
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
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // D-009 CA-18: liga a vitrine /dev/componentes só no servidor do E2E (o mesmo build responde
    // 404 sem a variável). Prevalece sobre o ambiente e o .env.
    env: { VITRINE_COMPONENTES: 'true' },
  },
});
