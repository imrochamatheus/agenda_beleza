import { expect, test, type Page } from '@playwright/test';

// D-027 CA-13 (sem JavaScript): o Turnstile simulado é um campo do formulário (seletor na vitrine, campo
// oculto na página real) e a recusa volta na resposta do POST; o aviso de consulta limitada é HTML.

test.use({ javaScriptEnabled: false });

const continuar = (page: Page) => page.getByRole('button', { name: 'Continuar' }).click();
const MENSAGEM_HUMANO = 'Não foi possível confirmar que você é uma pessoa. Tente novamente.';

async function ateOsDados(page: Page) {
  const resposta = await page.goto('/dev/reserva');
  expect(resposta?.status()).toBe(200);
  await page.getByRole('checkbox', { name: /Escova/ }).check();
  await continuar(page);
  await page.getByRole('list').getByRole('link', { name: /\d{2}\/\d{2}\/\d{4}$/ }).first().click();
  await page.getByRole('radio').first().check();
  await continuar(page);
  await expect(page.getByRole('heading', { level: 2, name: 'Seus dados' })).toBeVisible();
}

test.describe('CA-13: proteção sem JavaScript', () => {
  test('token inválido: recusa na resposta do POST, com os valores preservados; com o válido, confirma', async ({ page }) => {
    await ateOsDados(page);
    await page.getByRole('textbox', { name: /Nome/ }).fill('Maria da Silva');
    await page.getByRole('textbox', { name: /Telefone/ }).fill('(11) 98765-4321');
    await page.getByRole('checkbox', { name: /mensagens da minha reserva/ }).check();
    await page.getByLabel(/Verificação simulada/).selectOption({ label: 'Token inválido' });
    const envio = page.waitForResponse((r) => r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Confirmar reserva' }).click();
    expect((await envio).status()).toBe(200);
    await expect(page.getByText(MENSAGEM_HUMANO)).toBeVisible();
    await expect(page.getByText('Reserva confirmada!')).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: /Nome/ })).toHaveValue('Maria da Silva');

    await page.getByLabel(/Verificação simulada/).selectOption({ label: 'Token válido' });
    await page.getByRole('checkbox', { name: /mensagens da minha reserva/ }).check();
    const envio2 = page.waitForResponse((r) => r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Confirmar reserva' }).click();
    expect((await envio2).status()).toBe(200);
    await expect(page.getByText('Reserva confirmada!')).toBeVisible();
  });

  test('consulta limitada: aviso sem horários', async ({ page }) => {
    await page.goto('/dev/reserva?vista=limitado');
    await expect(page.getByText('Muitas tentativas. Aguarde alguns minutos e tente novamente.')).toBeVisible();
    await expect(page.getByRole('radio')).toHaveCount(0);
  });
});
