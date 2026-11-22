import { expect, test } from '@playwright/test';

import { analisarComAxe, semRolagemHorizontal } from './suporte/vitrine';

// D-040 CA-12: tela de assinatura (/dev/assinatura, sem banco): "Assinar" só sem vigente ou pendente,
// teclado, axe 4.14.0 e sem rolagem horizontal. Locale en-US de propósito.

test.use({ locale: 'en-US' });

for (const [situacao, botao] of [['', true], ['?situacao=pendente', true], ['?situacao=em_teste', false]] as const) {
  test(`situação ${situacao || 'sem assinatura'}: botão Assinar = ${botao}`, async ({ page }) => {
    const r = await page.goto(`/dev/assinatura${situacao}`);
    expect(r?.status()).toBe(200);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await expect(page.getByRole('button', { name: 'Assinar' })).toHaveCount(botao ? 1 : 0);
    await semRolagemHorizontal(page, '/dev/assinatura');
    await analisarComAxe(page, '/dev/assinatura');
  });
}

test('só com o teclado: Tab chega ao botão com foco visível e Enter mostra a resposta', async ({ page }) => {
  await page.goto('/dev/assinatura');
  for (let i = 0; i < 40; i += 1) {
    await page.keyboard.press('Tab');
    const nome = await page.evaluate(() => (document.activeElement as HTMLElement).textContent?.trim());
    if (nome === 'Assinar') break;
  }
  const foco = await page.evaluate(() => {
    const e = document.activeElement as HTMLElement;
    return { texto: e.textContent?.trim(), contorno: parseFloat(getComputedStyle(e).outlineWidth) };
  });
  expect(foco.texto).toBe('Assinar');
  expect(foco.contorno).toBeGreaterThan(0);
  await page.keyboard.press('Enter');
  await expect(page.getByText('Não foi possível falar com o provedor de pagamento')).toBeVisible();
});
