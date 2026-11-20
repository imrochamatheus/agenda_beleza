import { expect, test } from '@playwright/test';

// D-011 CA-20/RN-20 (tester, regressão do DEF-2): os formulários de /cadastro e /confirmar-email
// precisam funcionar SEM JavaScript (POST de <form action> antes da hidratação). Sem banco: os
// envios usam entradas inválidas, recusadas pela validação do servidor antes de qualquer acesso ao
// banco (RN-7, RN-14), então cabem no job e2e sem PostgreSQL.

test.use({ javaScriptEnabled: false });

test.describe('CA-20: formulários sem JavaScript', () => {
  test('CA-20: /cadastro vazio sem JS responde 200 com os erros do servidor', async ({ page }) => {
    await page.goto('/cadastro');
    const resposta = page.waitForResponse((r) => r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Criar conta' }).click();
    expect((await resposta).status()).toBe(200);
    await expect(page.getByText('Informe um e-mail válido.')).toBeVisible();
  });

  for (const url of ['/confirmar-email', '/confirmar-email?token=invalido']) {
    test(`CA-20: reenvio em ${url} sem JS responde 200 com o erro de validação do servidor`, async ({ page }) => {
      await page.goto(url);
      const resposta = page.waitForResponse((r) => r.request().method() === 'POST');
      await page.getByRole('button', { name: 'Reenviar link de confirmação' }).click();
      expect((await resposta).status()).toBe(200);
      await expect(page.getByText('Informe um e-mail válido.')).toBeVisible();
    });
  }
});
