import { expect, test, type Page } from '@playwright/test';

// D-022 CA-17: a busca (GET) e a edição (POST de <form action>) funcionam SEM JavaScript, preservando os
// valores digitados; a paginação é por links. Em /dev/clientes, sem banco: a ação só valida.

test.use({ javaScriptEnabled: false });

async function enviar(page: Page, botao: string) {
  const resposta = page.waitForResponse((r) => r.request().method() === 'POST');
  await page.getByRole('button', { name: botao }).click();
  expect((await resposta).status()).toBe(200);
}

test.describe('CA-17: clientes sem JavaScript', () => {
  test('busca é um GET: filtra, mantém o texto digitado e a paginação preserva a busca', async ({ page }) => {
    await page.goto('/dev/clientes');
    await expect(page.getByRole('status')).toHaveText('25 clientes · página 1 de 2');
    await page.getByRole('textbox', { name: 'Buscar por nome ou telefone' }).fill('zelia');
    await page.getByRole('button', { name: 'Buscar' }).click();
    await expect(page).toHaveURL(/\?q=zelia$/);
    await expect(page.getByRole('status')).toHaveText('1 cliente');
    await expect(page.getByRole('link', { name: 'Zélia' })).toBeVisible();
    await expect(page.locator('#clientes-busca')).toHaveValue('zelia');

    await page.goto('/dev/clientes?q=cliente');
    await page.getByRole('link', { name: 'Próxima' }).click();
    await expect(page).toHaveURL(/q=cliente&pagina=2$/);
    await expect(page.getByRole('link', { name: 'Anterior' })).toBeVisible();
  });

  test('edição: erros do servidor com os valores preservados; telefone em uso; depois sucesso normalizado', async ({ page }) => {
    await page.goto('/dev/clientes?vista=detalhe');
    await page.locator('#cliente-nome').fill('A');
    await page.locator('#cliente-telefone').fill('abc');
    await enviar(page, 'Salvar alterações');
    await expect(page.getByText('Corrija os campos indicados para salvar.')).toBeVisible();
    await expect(page.locator('#cliente-nome-erro')).toContainText('de 2 a 100 caracteres');
    await expect(page.locator('#cliente-telefone-erro')).toContainText('Informe um telefone brasileiro com DDD');
    await expect(page.getByRole('link', { name: /^Nome:/ })).toHaveAttribute('href', '#cliente-nome');
    await expect(page.getByRole('link', { name: /^Telefone:/ })).toHaveAttribute('href', '#cliente-telefone');
    await expect(page.locator('#cliente-nome')).toHaveValue('A');
    await expect(page.locator('#cliente-telefone')).toHaveValue('abc');

    await page.locator('#cliente-nome').fill('  Maria   Lima ');
    await page.locator('#cliente-telefone').fill('(11) 90000-0002');
    await enviar(page, 'Salvar alterações');
    await expect(page.locator('#cliente-telefone-erro')).toContainText('Este telefone já pertence a outra cliente do salão.');
    await expect(page.getByRole('link', { name: 'Ver cadastro de Yara Demonstração' })).toBeVisible();
    await expect(page.locator('#cliente-nome')).toHaveValue('  Maria   Lima ');

    await page.locator('#cliente-telefone').fill('21 91234-5678');
    await enviar(page, 'Salvar alterações');
    await expect(page.getByText('Cliente atualizada.')).toBeVisible();
    await expect(page.locator('#cliente-nome')).toHaveValue('Maria Lima');
    await expect(page.locator('#cliente-telefone')).toHaveValue('(21) 91234-5678');
  });
});
