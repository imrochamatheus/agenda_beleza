import { expect, test } from '@playwright/test';

// D-035 CA-2: a denúncia funciona SEM JavaScript (POST de <form action> antes da hidratação) em
// /dev/denuncia: erros por campo com os valores enviados; sucesso por PRG com a resposta uniforme.

test.use({ javaScriptEnabled: false, locale: 'en-US' });

test.describe('CA-2: denúncia sem JavaScript', () => {
  test('sem motivo: erro em pt-BR e o texto preservado; depois a resposta uniforme', async ({ page }) => {
    await page.goto('/dev/denuncia');
    // Sem JS, o <details> abre pelo clique do navegador (nativo).
    await page.locator('summary').first().click();
    await page.getByLabel(/Detalhes/).first().fill('texto da denúncia');
    const resposta = page.waitForResponse((r) => r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Enviar denúncia' }).first().click();
    expect((await resposta).status()).toBe(200);
    await expect(page.getByText('Escolha um motivo.')).toBeVisible();
    await expect(page.getByLabel(/Detalhes/).first()).toHaveValue('texto da denúncia');

    await page.getByRole('radio', { name: 'Expõe dados pessoais' }).first().check();
    await page.getByRole('button', { name: 'Enviar denúncia' }).first().click();
    await expect(page).toHaveURL(/\/dev\/denuncia\?denuncia=recebida/);
    await expect(page.getByRole('status')).toContainText('Recebemos sua denúncia');
  });

  test('detalhe acima de 500 caracteres: erro de campo e o motivo escolhido preservado', async ({ page }) => {
    await page.goto('/dev/denuncia');
    await page.locator('summary').first().click();
    await page.getByRole('radio', { name: 'Outro motivo' }).first().check();
    await page.getByLabel(/Detalhes/).first().fill('x'.repeat(501));
    await page.getByRole('button', { name: 'Enviar denúncia' }).first().click();
    await expect(page.getByText(/no máximo 500 caracteres/)).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Outro motivo' }).first()).toBeChecked();
  });
});
