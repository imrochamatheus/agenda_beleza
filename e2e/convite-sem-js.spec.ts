import { expect, test, type Page } from '@playwright/test';

// D-039 CA-15: o formulário de /dev/convite (o mesmo componente de /convite/[token]) funciona SEM
// JavaScript: POST de <form action> antes da hidratação. Sem banco: a ação da vitrine só valida a senha.

test.use({ javaScriptEnabled: false });

async function enviar(page: Page) {
  const resposta = page.waitForResponse((r) => r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Definir senha' }).click();
  expect((await resposta).status()).toBe(200);
}

test.describe('CA-15: convite sem JavaScript', () => {
  test('senha curta: erro no campo; senha válida: "Senha definida" com link para entrar', async ({ page }) => {
    await page.goto('/dev/convite');
    await page.getByLabel('Senha', { exact: false }).first().fill('curta');
    await enviar(page);
    await expect(page.getByText('A senha precisa ter pelo menos 8 caracteres.')).toBeVisible();
    await expect(page.getByLabel('Senha', { exact: false }).first()).toHaveValue('');

    await page.getByLabel('Senha', { exact: false }).first().fill('uma-senha-forte-1');
    await enviar(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Senha definida' })).toBeVisible();
    await expect(page.locator('#conteudo').getByRole('link', { name: 'Entrar' })).toHaveAttribute('href', '/entrar');
  });

  test('/convite/<token malformado> sem JavaScript mostra a recusa', async ({ page }) => {
    await page.goto(`/convite/${'T'.repeat(42)}!`);
    await expect(page.getByRole('heading', { level: 1, name: 'Convite inválido' })).toBeVisible();
  });
});
