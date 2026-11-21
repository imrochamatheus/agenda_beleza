import { expect, test } from '@playwright/test';

// D-032 CA-16: o formulário de avaliação funciona SEM JavaScript (POST de <form action> antes da
// hidratação) em /dev/avaliacao: erros por campo com os valores enviados; sucesso; e a resposta
// uniforme do link inválido.

test.use({ javaScriptEnabled: false, locale: 'en-US' });

async function enviar(page: import('@playwright/test').Page) {
  const resposta = page.waitForResponse((r) => r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Enviar avaliação' }).click();
  expect((await resposta).status()).toBe(200);
}

test.describe('CA-16: avaliação sem JavaScript', () => {
  test('sem nota nem aceite: erros em pt-BR e o comentário preservado; depois sucesso', async ({ page }) => {
    await page.goto('/dev/avaliacao');
    await page.getByLabel(/Comentário/).fill('Gostei muito');
    await enviar(page);
    await expect(page.locator('#avaliar-nota-erro')).toContainText('Escolha uma nota de 1 a 5.');
    await expect(page.getByText('Para publicar a avaliação, é preciso autorizar a publicação.')).toBeVisible();
    await expect(page.getByLabel(/Comentário/)).toHaveValue('Gostei muito');

    await page.getByRole('radio', { name: '4' }).check();
    await page.getByRole('checkbox').check();
    await enviar(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Avaliação enviada' })).toBeVisible();
    await expect(page.getByRole('status')).toContainText('Obrigada! Sua avaliação foi publicada.');
  });

  test('comentário acima de 1000 caracteres: erro de campo e a nota escolhida preservada', async ({ page }) => {
    await page.goto('/dev/avaliacao');
    await page.getByRole('radio', { name: '2' }).check();
    await page.getByRole('checkbox').check();
    await page.getByLabel(/Comentário/).fill('x'.repeat(1001));
    await enviar(page);
    await expect(page.locator('#avaliar-comentario-erro')).toContainText('no máximo 1000 caracteres');
    await expect(page.getByRole('radio', { name: '2' })).toBeChecked();
    await expect(page.getByRole('checkbox')).toBeChecked();
  });

  test('link inválido: a resposta uniforme', async ({ page }) => {
    await page.goto('/dev/avaliacao?vista=invalido');
    await expect(page.getByRole('alert')).toContainText('Link inválido ou expirado.');
  });
});
