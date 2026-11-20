import { expect, test, type Page } from '@playwright/test';

// D-017 CA-20 (D-26): os dois formulários de configurações funcionam SEM JavaScript (POST de
// <form action> antes da hidratação; a resposta traz o estado com erros e os valores digitados, ou o
// sucesso). Em /dev/configuracoes, sem banco: as ações só validam.

test.use({ javaScriptEnabled: false });

async function enviar(page: Page, botao: string) {
  const resposta = page.waitForResponse((r) => r.request().method() === 'POST');
  await page.getByRole('button', { name: botao }).click();
  expect((await resposta).status()).toBe(200);
}

test.describe('CA-20: configurações sem JavaScript', () => {
  test('regras: erros do servidor com os valores preservados; depois sucesso com os valores normalizados', async ({ page }) => {
    await page.goto('/dev/configuracoes');
    await page.locator('#config-nome').fill('  Studio   Sem JS ');
    await page.locator('#config-fuso').selectOption('America/Manaus');
    await page.locator('#config-grade').selectOption('30');
    await page.locator('#config-antecedencia').fill('48');
    await page.locator('#config-janela').fill('2');
    await page.locator('#config-intervalo').fill('5.5');
    await enviar(page, 'Salvar configurações');
    await expect(page.getByText('Corrija os campos indicados para salvar.')).toBeVisible();
    await expect(page.locator('#config-antecedencia-erro')).toContainText('A antecedência mínima precisa ser menor que a janela máxima.');
    await expect(page.locator('#config-intervalo-erro')).toContainText('Informe o intervalo em minutos inteiros, de 0 a 120.');
    await expect(page.getByRole('link', { name: /Antecedência mínima \(horas\):/ })).toHaveAttribute('href', '#config-antecedencia');
    await expect(page.locator('#config-nome')).toHaveValue('  Studio   Sem JS ');
    await expect(page.locator('#config-fuso')).toHaveValue('America/Manaus');
    await expect(page.locator('#config-grade')).toHaveValue('30');
    await expect(page.locator('#config-antecedencia')).toHaveValue('48');
    await expect(page.locator('#config-intervalo')).toHaveValue('5.5');

    await page.locator('#config-antecedencia').fill('47');
    await page.locator('#config-intervalo').fill('5');
    await enviar(page, 'Salvar configurações');
    await expect(page.getByText('Configurações salvas.')).toBeVisible();
    await expect(page.locator('#config-nome')).toHaveValue('Studio Sem JS');
    await expect(page.locator('#config-fuso')).toHaveValue('America/Manaus');
    await expect(page.locator('#config-antecedencia')).toHaveValue('47');
  });

  test('slug: formato inválido com o valor preservado; em uso; sucesso', async ({ page }) => {
    await page.goto('/dev/configuracoes');
    await page.locator('#config-slug').fill('bela studio');
    await enviar(page, 'Trocar endereço');
    await expect(page.locator('#config-slug-erro')).toContainText('Use de 3 a 60 caracteres');
    await expect(page.locator('#config-slug')).toHaveValue('bela studio');
    await expect(page.getByRole('link', { name: /Novo endereço:/ })).toHaveAttribute('href', '#config-slug');

    await page.locator('#config-slug').fill('em-uso');
    await enviar(page, 'Trocar endereço');
    await expect(page.locator('#config-slug-erro')).toContainText('Este endereço já está em uso. Escolha outro.');

    await page.locator('#config-slug').fill('bela-studio');
    await enviar(page, 'Trocar endereço');
    await expect(page.getByText('Endereço público alterado. O endereço anterior continua levando ao salão.')).toBeVisible();
    await expect(page.locator('#config-slug')).toHaveValue('');
  });
});
