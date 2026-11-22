import { expect, test } from '@playwright/test';

// D-043: sem JavaScript, o detalhe mostra a situação das mensagens e a grade, a marca de falha (HTML do
// servidor). /dev/agenda e /dev/mensagens-reserva, sem banco.

test.use({ javaScriptEnabled: false, locale: 'en-US' });

test.describe('sem JavaScript', () => {
  test('detalhe com falha: seção, texto e link de volta', async ({ page }) => {
    await page.goto('/dev/agenda?reserva=demo-r1');
    await expect(page.getByRole('heading', { level: 2, name: 'Mensagens de WhatsApp' })).toBeVisible();
    await expect(page.getByText('Falha ao enviar confirmação por WhatsApp')).toBeVisible();
    await expect(page.getByText(/3 tentativas/)).toBeVisible();
    await page.getByRole('link', { name: 'Voltar para a agenda' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Agenda' })).toBeVisible();
  });

  test('grade do dia e semana mostram a marca; abrir o bloco leva ao detalhe', async ({ page }) => {
    await page.goto('/dev/agenda');
    await expect(page.getByRole('link', { name: /Falha ao enviar mensagem/ })).toHaveCount(2);
    await page.getByRole('link', { name: /Falha ao enviar mensagem.*Maria Souza/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Reserva' })).toBeVisible();
    await expect(page.getByText('Falha ao enviar confirmação por WhatsApp')).toBeVisible();
    await page.goto('/dev/agenda?visao=semana');
    await expect(page.getByText('Falha ao enviar mensagem', { exact: true }).first()).toBeVisible();
  });

  test('vitrine tipo × estado e estado vazio', async ({ page }) => {
    await page.goto('/dev/mensagens-reserva');
    await expect(page.locator('li[data-estado]')).toHaveCount(28);
    await page.goto('/dev/mensagens-reserva?vista=vazia');
    await expect(page.getByText('Nenhuma mensagem de WhatsApp para esta reserva.')).toBeVisible();
  });
});
