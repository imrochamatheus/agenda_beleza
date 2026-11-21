import { expect, test, type Page } from '@playwright/test';

// D-034 CA-2/CA-13: o login do admin funciona SEM JavaScript (POST de <form action> antes da
// hidratação): erros em pt-BR com o e-mail preservado, e o cadastro mostra QR e chave em texto.

test.use({ javaScriptEnabled: false, locale: 'en-US' });

async function enviar(page: Page, nome: string) {
  const resposta = page.waitForResponse((r) => r.request().method() === 'POST');
  await page.getByRole('button', { name: nome }).click();
  expect((await resposta).status()).toBe(200);
}

test.describe('login do admin sem JavaScript', () => {
  test('vitrine: erros de campo, e-mail preservado e depois aviso de formato válido', async ({ page }) => {
    await page.goto('/dev/admin-entrar');
    await page.getByLabel('E-mail').fill('admin@exemplo.test');
    await enviar(page, 'Continuar');
    await expect(page.getByText('Informe sua senha.')).toBeVisible();
    await expect(page.getByLabel('E-mail')).toHaveValue('admin@exemplo.test');
    await page.getByLabel('Senha').fill('qualquer coisa');
    await enviar(page, 'Continuar');
    await expect(page.getByText('Demonstração: formato válido, nada foi enviado.')).toBeVisible();
  });

  test('vitrine do código: formato inválido e válido', async ({ page }) => {
    await page.goto('/dev/admin-entrar?vista=codigo');
    await page.getByLabel('Código de 6 dígitos').fill('abc');
    await enviar(page, 'Verificar');
    await expect(page.getByText('Informe o código de 6 dígitos.')).toBeVisible();
    await page.getByLabel('Código de 6 dígitos').fill('654321');
    await enviar(page, 'Verificar');
    await expect(page.getByText('Demonstração: formato válido, nada foi enviado.')).toBeVisible();
  });

  test('cadastro: QR (SVG inline) e chave em texto presentes sem JavaScript', async ({ page }) => {
    await page.goto('/dev/admin-entrar?vista=cadastro');
    await expect(page.getByRole('img', { name: 'QR code para o aplicativo autenticador' })).toBeVisible();
    await expect(page.locator('code')).toContainText('JBSW Y3DP');
  });

  test('rota real /admin/entrar: envio vazio mostra os erros sem banco', async ({ page }) => {
    await page.goto('/admin/entrar');
    await enviar(page, 'Continuar');
    await expect(page.getByText('Informe seu e-mail.')).toBeVisible();
    await expect(page.getByText('Informe sua senha.')).toBeVisible();
  });
});
