import { expect, test } from '@playwright/test';

// D-044 CA-14: os salões do admin funcionam SEM JavaScript em /dev/admin-saloes: filtros por GET e os formulários por
// POST (server action), com o resultado e a etapa 2 na própria resposta (sem PRG e sem o motivo na URL).

test.use({ javaScriptEnabled: false, locale: 'en-US' });

test.describe('salões do admin sem JavaScript', () => {
  test('busca e filtros por GET; paginação preserva os filtros', async ({ page }) => {
    await page.goto('/dev/admin-saloes');
    await expect(page.getByRole('link', { name: /^Abrir / })).toHaveCount(20);
    await page.getByLabel('Buscar por nome, endereço ou e-mail do gestor').fill('lume');
    await page.getByLabel('Suspensão manual').selectOption('nao');
    await page.getByRole('button', { name: 'Filtrar' }).click();
    await expect(page).toHaveURL(/q=lume&estado=&suspenso=nao/);
    await expect(page.getByRole('link', { name: /^Abrir / })).toHaveCount(1);
    await page.goto('/dev/admin-saloes?suspenso=nao');
    await page.getByRole('link', { name: 'Próxima' }).click();
    await expect(page).toHaveURL(/suspenso=nao&pagina=2/);
  });

  test('editar: erro de campo com resumo e valores preservados; depois, salvar', async ({ page }) => {
    await page.goto('/dev/admin-saloes?vista=detalhe');
    await page.getByLabel('Nome', { exact: true }).fill('A');
    await page.getByLabel('Intervalo da grade (minutos)').selectOption('30');
    await page.getByRole('button', { name: 'Salvar alterações' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Corrija os campos indicados para salvar.' })).toBeVisible();
    await expect(page.getByLabel('Nome', { exact: true })).toHaveValue('A');
    await page.getByLabel('Nome', { exact: true }).fill('Studio Aurora Novo');
    await page.getByRole('button', { name: 'Salvar alterações' }).click();
    await expect(page.getByText('Dados do salão salvos.')).toBeVisible();
  });

  test('suspender em duas etapas: o motivo vai por POST, nunca na URL', async ({ page }) => {
    await page.goto('/dev/admin-saloes?vista=detalhe');
    await page.getByLabel(/^Motivo/).fill('ab');
    await page.getByRole('button', { name: 'Continuar' }).click();
    await expect(page.getByText('Informe o motivo (5 a 280 caracteres).').first()).toBeVisible();
    await page.getByLabel(/^Motivo/).fill('Pedido do gestor');
    await page.getByRole('button', { name: 'Continuar' }).click();
    await expect(page.getByText('Suspender Studio Aurora? Ela deixa de aceitar novas reservas agora.')).toBeVisible();
    await expect(page.locator('blockquote')).toHaveText('Pedido do gestor');
    expect(page.url()).not.toContain('Pedido');
    await page.getByRole('button', { name: 'Suspender salão' }).click();
    await expect(page.getByText('Salão suspenso.')).toBeVisible();
  });

  test('reativar (uma etapa) na vista do salão suspenso', async ({ page }) => {
    await page.goto('/dev/admin-saloes?vista=detalhe-suspenso');
    await expect(page.getByText('Suspenso manualmente em 20/11/2030 às 09:12.')).toBeVisible();
    await page.getByRole('button', { name: 'Reativar salão' }).click();
    await expect(page.getByText('Salão reativado.')).toBeVisible();
  });

  test('estender o teste em duas etapas: prévia, confirmação, e os resultados do provedor', async ({ page }) => {
    await page.goto('/dev/admin-saloes?vista=detalhe');
    await page.getByLabel(/^Dias a acrescentar/).fill('1e1');
    await page.getByRole('button', { name: 'Ver novo fim' }).click();
    await expect(page.getByText('Informe um número inteiro de 1 a 90.').first()).toBeVisible();
    await page.getByLabel(/^Dias a acrescentar/).fill('10');
    await page.getByRole('button', { name: 'Ver novo fim' }).click();
    await expect(page.getByText('30/11/2030 às 14:00 → 10/12/2030 às 14:00')).toBeVisible();
    await page.getByRole('button', { name: 'Estender teste em 10 dias' }).click();
    await expect(page.getByText('Teste estendido até 10/12/2030 às 14:00.')).toBeVisible();

    await page.goto('/dev/admin-saloes?vista=detalhe');
    await page.getByLabel(/^Dias a acrescentar/).fill('13');
    await page.getByRole('button', { name: 'Ver novo fim' }).click();
    await page.getByRole('button', { name: 'Estender teste em 13 dias' }).click();
    await expect(page.getByText('O provedor não refletiu o adiamento; nada foi alterado.')).toBeVisible();
  });

  test('vista sem assinatura: a recusa vem no lugar do campo', async ({ page }) => {
    await page.goto('/dev/admin-saloes?vista=detalhe-sem-assinatura');
    await expect(page.getByText('Este salão não tem assinatura.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ver novo fim' })).toHaveCount(0);
  });
});
