import { expect, test } from '@playwright/test';

// D-040 CA-12: o formulário "Assinar" é um POST nativo e funciona sem JavaScript.

test.use({ javaScriptEnabled: false, locale: 'en-US' });

test('Assinar sem JavaScript devolve a resposta da ação na própria página', async ({ page }) => {
  await page.goto('/dev/assinatura');
  const resposta = page.waitForResponse((r) => r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Assinar' }).click();
  expect((await resposta).status()).toBe(200);
  await expect(page.getByText('Não foi possível falar com o provedor de pagamento')).toBeVisible();
});

test('páginas reais sem sessão redirecionam a /entrar?proximo=', async ({ page }) => {
  for (const rota of ['/painel/assinatura', '/painel/assinatura/retorno']) {
    await page.goto(rota);
    expect(page.url()).toContain(`/entrar?proximo=${encodeURIComponent(rota)}`);
  }
});
