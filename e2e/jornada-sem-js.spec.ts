import { expect, test } from '@playwright/test';

// D-015 CA-18 (D-11): o formulário da jornada funciona SEM JavaScript (POST de <form action> antes da
// hidratação; <details> abre nativamente). Em /dev/jornada, sem banco: a ação só valida.

test.use({ javaScriptEnabled: false });

const DEMONSTRACAO = 'Jornada válida (demonstração: nada foi gravado).';

test.describe('CA-18: jornada sem JavaScript', () => {
  test('CA-18: 6 intervalos num dia → POST 200 e a mensagem do servidor', async ({ page }) => {
    await page.goto('/dev/jornada');
    await page.locator('summary', { hasText: 'Terça-feira' }).click();
    const horas = [8, 10, 12, 14, 16, 18];
    for (const [n, h] of horas.entries()) {
      await page.locator(`#jornada-2-${n}-inicio`).fill(`${h}:00`);
      await page.locator(`#jornada-2-${n}-fim`).fill(`${h}:30`);
    }
    const resposta = page.waitForResponse((r) => r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Salvar jornada' }).click();
    expect((await resposta).status()).toBe(200);
    await expect(page.getByText(DEMONSTRACAO)).toBeVisible();
    // Valores canônicos devolvidos aos campos (formato HH:MM).
    await expect(page.locator('#jornada-2-0-inicio')).toHaveValue('08:00');
    await expect(page.locator('#jornada-2-5-fim')).toHaveValue('18:30');
  });

  test('CA-18: inválido → erros do servidor, dia aberto e valores preservados', async ({ page }) => {
    await page.goto('/dev/jornada');
    await page.locator('summary', { hasText: 'Quarta-feira' }).click();
    await page.locator('#jornada-3-2-inicio').fill('22:00');
    await page.locator('#jornada-3-2-fim').fill('02:00');
    await page.locator('#jornada-3-3-inicio').fill('09:07');
    await page.locator('#jornada-3-3-fim').fill('10:00');
    const resposta = page.waitForResponse((r) => r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Salvar jornada' }).click();
    expect((await resposta).status()).toBe(200);
    await expect(page.getByText('Corrija os campos indicados para salvar a jornada.')).toBeVisible();
    await expect(page.locator('#jornada-3-2-erro')).toContainText('O fim precisa ser depois do início.');
    await expect(page.locator('#jornada-3-3-inicio-erro')).toContainText('Use minutos múltiplos de 5');
    await expect(page.locator('details', { hasText: 'Quarta-feira' })).toHaveAttribute('open', '');
    await expect(page.locator('#jornada-3-2-inicio')).toHaveValue('22:00');
    await expect(page.locator('#jornada-3-3-inicio')).toHaveValue('09:07');
    // O link do resumo aponta para o campo.
    await expect(page.getByRole('link', { name: /Quarta-feira, intervalo 3/ })).toHaveAttribute('href', '#jornada-3-2-inicio');
  });

  test('CA-18: o profissional vê a própria jornada (somente leitura) sem JS', async ({ page }) => {
    await page.goto('/dev/jornada?modo=leitura');
    await expect(page.getByText('Só o gestor do salão altera a jornada.')).toBeVisible();
    await expect(page.getByText('09:00–12:00, 13:00–18:00').first()).toBeVisible();
    await expect(page.getByText('Folga')).toBeVisible();
    await expect(page.locator('main input')).toHaveCount(0);
  });
});
