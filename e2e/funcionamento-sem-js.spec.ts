import { expect, test, type Page } from '@playwright/test';

// D-020 CA-5 (D-14): o formulário do funcionamento funciona SEM JavaScript (POST de <form action> antes
// da hidratação; <details> abre nativamente). Em /dev/funcionamento, sem banco: a ação só valida.

test.use({ javaScriptEnabled: false });

const DEMONSTRACAO = 'Horário válido (demonstração: nada foi gravado).';

async function enviar(page: Page) {
  const resposta = page.waitForResponse((r) => r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Salvar horário' }).click();
  expect((await resposta).status()).toBe(200);
}

test.describe('CA-5: funcionamento sem JavaScript', () => {
  test('6 intervalos num dia → POST 200, sucesso e valores canônicos', async ({ page }) => {
    await page.goto('/dev/funcionamento?modo=nao-informado');
    await page.getByRole('radio', { name: 'Informar o horário abaixo' }).check();
    await page.locator('summary', { hasText: 'Terça-feira' }).click();
    for (const [n, h] of [8, 10, 12, 14, 16, 18].entries()) {
      await page.locator(`#funcionamento-2-${n}-inicio`).fill(`${h}:00`);
      await page.locator(`#funcionamento-2-${n}-fim`).fill(`${h}:30`);
    }
    await enviar(page);
    await expect(page.getByText(DEMONSTRACAO)).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Informar o horário abaixo' })).toBeChecked();
    await expect(page.locator('#funcionamento-2-0-inicio')).toHaveValue('08:00');
    await expect(page.locator('#funcionamento-2-5-fim')).toHaveValue('18:30');
    await expect(page.locator('summary', { hasText: 'Terça-feira' })).toContainText('08:00–08:30');
  });

  test('inválido → erros do servidor, dia aberto, modo e valores preservados; "Não informar" descarta', async ({ page }) => {
    await page.goto('/dev/funcionamento');
    await page.locator('summary', { hasText: 'Quarta-feira' }).click();
    await page.locator('#funcionamento-3-1-inicio').fill('22:00');
    await page.locator('#funcionamento-3-1-fim').fill('02:00');
    await enviar(page);
    await expect(page.getByText('Corrija os campos indicados para salvar o horário de funcionamento.')).toBeVisible();
    await expect(page.locator('#funcionamento-3-1-erro')).toContainText('O fim precisa ser depois do início.');
    await expect(page.locator('details', { hasText: 'Quarta-feira' })).toHaveAttribute('open', '');
    await expect(page.locator('#funcionamento-3-1-inicio')).toHaveValue('22:00');
    await expect(page.locator('#funcionamento-3-0-inicio')).toHaveValue('09:00');
    await expect(page.getByRole('radio', { name: 'Informar o horário abaixo' })).toBeChecked();
    await expect(page.getByRole('link', { name: /Quarta-feira, intervalo 2/ })).toHaveAttribute('href', '#funcionamento-3-1-inicio');

    await page.getByRole('radio', { name: /Não informar/ }).check();
    await enviar(page);
    await expect(page.getByText(DEMONSTRACAO)).toBeVisible();
    await expect(page.getByRole('radio', { name: /Não informar/ })).toBeChecked();
    await expect(page.locator('#funcionamento-3-0-inicio')).toHaveValue('');
  });
});
