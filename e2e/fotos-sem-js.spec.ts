import { expect, test } from '@playwright/test';

import { arquivoDeFoto, textoComoJpg } from './suporte/imagens';

// D-021 CA-15 (sem JavaScript): o envio multipart nativo funciona (sucesso e erro) e as ações de mover,
// remover e editar a descrição também (formulários de ação de servidor com PRG). Em /dev/fotos, sem banco.

test.use({ javaScriptEnabled: false });

test.describe('CA-15: fotos sem JavaScript', () => {
  test('envio multipart nativo: sucesso e erro de tipo, com o resultado na página', async ({ page }) => {
    await page.goto('/dev/fotos');
    await page.locator('#foto-arquivo').setInputFiles(await arquivoDeFoto());
    await page.locator('#foto-alt').fill('Fachada do salão');
    const resposta = page.waitForResponse((r) => r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Enviar foto' }).click();
    const r = await resposta;
    expect(r.status()).toBe(303);
    expect(r.headers().location).toBe('/dev/fotos?envio=ok');
    await expect(page).toHaveURL(/\/dev\/fotos\?envio=ok$/);
    await expect(page.getByText('Foto enviada.')).toBeVisible();

    await page.locator('#foto-arquivo').setInputFiles(textoComoJpg());
    await page.locator('#foto-alt').fill('Texto');
    await page.getByRole('button', { name: 'Enviar foto' }).click();
    await expect(page).toHaveURL(/envio=tipo$/);
    await expect(page.getByRole('alert')).toContainText('Envie uma foto em JPEG, PNG ou WebP.');
    await expect(page.locator('#foto-arquivo-erro')).toContainText('Envie uma foto em JPEG, PNG ou WebP.');
  });

  test('valor desconhecido em ?envio= não mostra nada nem quebra a página', async ({ page }) => {
    const r = await page.goto('/dev/fotos?envio=%3Cscript%3Ealert(1)%3C/script%3E');
    expect(r?.status()).toBe(200);
    await expect(page.locator('#resultado-fotos')).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1, name: 'Fotos do salão' })).toBeVisible();
  });

  test('mover, remover e editar a descrição funcionam por POST de formulário', async ({ page }) => {
    await page.goto('/dev/fotos');
    await page.getByRole('button', { name: 'Mover para cima: foto 2' }).click();
    await expect(page).toHaveURL(/acao=movida$/);
    await expect(page.getByText('Ordem das fotos alterada.')).toBeVisible();

    await page.getByRole('button', { name: 'Remover a foto 3' }).click();
    await expect(page).toHaveURL(/acao=removida$/);
    await expect(page.getByText('Foto removida.')).toBeVisible();

    await page.getByRole('textbox', { name: 'Descrição da foto 1' }).fill('Outro texto');
    await page.getByRole('button', { name: 'Salvar descrição da foto 1' }).click();
    await expect(page).toHaveURL(/acao=alt_ok$/);
    await expect(page.getByText('Descrição da foto salva.')).toBeVisible();
  });
});
