import { expect, test } from '@playwright/test';

// D-040 CA-12 e D-042 CA-5: sem JavaScript os formulários são POSTs nativos, a etapa 1 é um link GET e o
// resultado volta na própria resposta (sem PRG). Em /dev/assinatura o provedor "está indisponível".

test.use({ javaScriptEnabled: false, locale: 'en-US' });

test('Assinar sem JavaScript devolve a resposta da ação na própria página', async ({ page }) => {
  await page.goto('/dev/assinatura');
  const resposta = page.waitForResponse((r) => r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Assinar', exact: true }).click();
  expect((await resposta).status()).toBe(200);
  await expect(page.getByText('Não foi possível falar com o provedor de pagamento')).toBeVisible();
});

test('cancelar em duas etapas sem JavaScript: link GET, depois POST com "Erro de pagamento" e o estado intacto', async ({ page }) => {
  const metodos: string[] = [];
  page.on('request', (r) => {
    if (r.resourceType() === 'document') metodos.push(r.method());
  });
  await page.goto('/dev/assinatura?situacao=ativa');
  await page.getByRole('link', { name: 'Cancelar assinatura' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Cancelar assinatura?' })).toBeVisible();
  expect(metodos).toEqual(['GET', 'GET']);
  const resposta = page.waitForResponse((r) => r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Sim, cancelar assinatura' }).click();
  expect((await resposta).status()).toBe(200);
  const alerta = page.getByRole('main').getByRole('alert');
  await expect(alerta).toContainText('Erro de pagamento:');
  await expect(alerta).toContainText('Nada foi alterado; tente novamente.');
  await expect(page.getByRole('heading', { level: 2, name: 'Assinatura ativa.' })).toBeVisible();
  // O erro não fecha a etapa 2: dá para tentar de novo ou manter.
  await expect(page.getByRole('button', { name: 'Sim, cancelar assinatura' })).toBeVisible();
  await page.getByRole('link', { name: 'Manter assinatura' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Cancelar assinatura?' })).toHaveCount(0);
});

test('regularizar sem JavaScript mostra o erro de pagamento e não muda a situação', async ({ page }) => {
  await page.goto('/dev/assinatura?situacao=suspensa');
  await page.getByRole('button', { name: 'Regularizar pagamento' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Erro de pagamento:');
  await expect(page.getByRole('heading', { level: 2, name: 'Assinatura suspensa por falta de pagamento.' })).toBeVisible();
});

test('páginas reais sem sessão redirecionam a /entrar?proximo=', async ({ page }) => {
  for (const rota of ['/painel/assinatura', '/painel/assinatura/retorno']) {
    await page.goto(rota);
    expect(page.url()).toContain(`/entrar?proximo=${encodeURIComponent(rota)}`);
  }
});
