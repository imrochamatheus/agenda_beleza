import { expect, test, type Page } from '@playwright/test';

// D-020 CA-5 (D-14): o formulário do perfil funciona SEM JavaScript (POST de <form action> antes da
// hidratação; a resposta traz o estado com os erros e os valores digitados, inclusive as caixas, ou o
// sucesso). Em /dev/perfil, sem banco: a ação só valida.

test.use({ javaScriptEnabled: false });

async function enviar(page: Page) {
  const resposta = page.waitForResponse((r) => r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Salvar perfil' }).click();
  expect((await resposta).status()).toBe(200);
}

test.describe('CA-5: perfil sem JavaScript', () => {
  test('erros do servidor com valores e caixas preservados; depois sucesso com os valores normalizados', async ({ page }) => {
    await page.goto('/dev/perfil?vazio=1');
    await expect(page.locator('#perfil-descricao-contador')).toHaveCount(0);
    await page.locator('#perfil-descricao').fill('Linha 1\nLinha 2');
    await page.locator('#perfil-cidade').fill('Curitiba');
    await page.locator('#perfil-uf').selectOption('PR');
    await page.locator('#perfil-cep').fill('8000-000');
    await page.locator('#perfil-whatsapp').fill('(41) 98765-4321');
    await page.locator('#perfil-instagram').fill('@Salao.Curitiba');
    await page.getByRole('checkbox', { name: 'Pix' }).check();
    await page.getByRole('checkbox', { name: 'Estacionamento' }).check();
    await enviar(page);
    await expect(page.getByText('Corrija os campos indicados para salvar o perfil.')).toBeVisible();
    await expect(page.locator('#perfil-logradouro-erro')).toContainText('deixe o endereço todo em branco');
    await expect(page.locator('#perfil-cep-erro')).toContainText('Informe o CEP com 8 dígitos');
    await expect(page.getByRole('link', { name: /CEP:/ })).toHaveAttribute('href', '#perfil-cep');
    await expect(page.locator('#perfil-descricao')).toHaveValue('Linha 1\nLinha 2');
    await expect(page.locator('#perfil-cidade')).toHaveValue('Curitiba');
    await expect(page.locator('#perfil-uf')).toHaveValue('PR');
    await expect(page.locator('#perfil-cep')).toHaveValue('8000-000');
    await expect(page.locator('#perfil-instagram')).toHaveValue('@Salao.Curitiba');
    await expect(page.getByRole('checkbox', { name: 'Pix' })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: 'Estacionamento' })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: 'Dinheiro' })).not.toBeChecked();

    await page.locator('#perfil-logradouro').fill('Rua XV de Novembro');
    await page.locator('#perfil-numero').fill('100');
    await page.locator('#perfil-bairro').fill('Centro');
    await page.locator('#perfil-cep').fill('80020310');
    await enviar(page);
    await expect(page.getByText('Perfil válido (demonstração: nada foi gravado).')).toBeVisible();
    await expect(page.locator('#perfil-cep')).toHaveValue('80020-310');
    await expect(page.locator('#perfil-whatsapp')).toHaveValue('(41) 98765-4321');
    await expect(page.locator('#perfil-instagram')).toHaveValue('salao.curitiba');
    await expect(page.getByRole('checkbox', { name: 'Pix' })).toBeChecked();
  });
});
