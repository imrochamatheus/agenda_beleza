import { expect, test } from '@playwright/test';

// D-035: a moderação funciona SEM JavaScript em /dev/moderacao: filtros por GET e os formulários por POST
// com PRG (código fechado no `?resultado=`).

test.use({ javaScriptEnabled: false, locale: 'en-US' });

test.describe('moderação sem JavaScript', () => {
  test('filtro por estado por GET', async ({ page }) => {
    await page.goto('/dev/moderacao');
    await page.getByLabel('Estado').selectOption('retirada');
    await page.getByRole('button', { name: 'Filtrar' }).click();
    await expect(page).toHaveURL(/estado=retirada/);
    await expect(page.getByRole('link', { name: /Moderar avaliação/ })).toHaveCount(1);
  });

  test('motivo curto: erro; motivo válido: confirmação; arquivar: confirmação', async ({ page }) => {
    await page.goto('/dev/moderacao?vista=detalhe');
    await page.getByLabel(/Motivo da moderação/).fill('ab');
    await page.getByRole('button', { name: 'Retirar avaliação' }).click();
    await expect(page).toHaveURL(/resultado=motivo_invalido/);
    await expect(page.getByRole('alert')).toContainText('Informe o motivo');

    await page.getByLabel(/Motivo da moderação/).fill('Linguagem ofensiva');
    await page.getByRole('button', { name: 'Retirar avaliação' }).click();
    await expect(page).toHaveURL(/resultado=retirada/);
    await expect(page.getByRole('status')).toContainText('Avaliação retirada');

    await page.getByRole('button', { name: 'Arquivar todas as pendentes (2)' }).click();
    await expect(page).toHaveURL(/resultado=arquivadas/);
    await expect(page.getByRole('status')).toContainText('Denúncias arquivadas');
  });
});
