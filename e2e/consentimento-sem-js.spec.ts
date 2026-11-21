import { expect, test } from '@playwright/test';

// D-023 CA-19: as caixas de consentimento funcionam SEM JavaScript (POST de <form action> antes da
// hidratação): erro em pt-BR com as caixas no estado enviado; sucesso com a obrigatória marcada.

test.use({ javaScriptEnabled: false });

async function enviar(page: import('@playwright/test').Page) {
  const resposta = page.waitForResponse((r) => r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Reservar' }).click();
  expect((await resposta).status()).toBe(200);
}

test.describe('CA-19: consentimento sem JavaScript', () => {
  test('sem a obrigatória: erro e a opcional marcada permanece marcada; depois sucesso', async ({ page }) => {
    await page.goto('/dev/consentimento');
    await page.locator('#consentimento-convite').check();
    await enviar(page);
    await expect(page.getByRole('alert')).toContainText('Para reservar, aceite os Termos, a Política de Privacidade e o recebimento das mensagens da reserva.');
    await expect(page.locator('#consentimento-convite')).toBeChecked();
    await expect(page.locator('#consentimento-mensagens')).not.toBeChecked();

    await page.locator('#consentimento-mensagens').check();
    await enviar(page);
    await expect(page.getByText('Seriam gravadas: mensagens da reserva e convite de avaliação.')).toBeVisible();
    await expect(page.locator('#consentimento-mensagens')).toBeChecked();
    await expect(page.locator('#consentimento-convite')).toBeChecked();
  });

  test('só a obrigatória: sucesso grava só as mensagens', async ({ page }) => {
    await page.goto('/dev/consentimento');
    await page.locator('#consentimento-mensagens').check();
    await enviar(page);
    await expect(page.getByText('Seriam gravadas: mensagens da reserva.')).toBeVisible();
    await expect(page.locator('#consentimento-convite')).not.toBeChecked();
  });
});
