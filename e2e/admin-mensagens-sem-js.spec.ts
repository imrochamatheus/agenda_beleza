import { expect, test } from '@playwright/test';

// D-045 CA-14: as telas do admin funcionam SEM JavaScript em /dev/admin-mensagens: filtros por GET, o reenvio em
// duas etapas (GET ?confirmar= → POST → PRG ?reenvio=), os <details> nativos e a paginação por links.

test.use({ javaScriptEnabled: false, locale: 'en-US' });

const ROTA = '/dev/admin-mensagens';
const FALHOU_1 = '00000000-0000-4000-8000-000000000002';

test.describe('admin sem JavaScript', () => {
  test('filtros da fila por GET e "Limpar filtros"', async ({ page }) => {
    await page.goto(ROTA);
    await expect(page.getByText('20 de 47 mensagens', { exact: true })).toBeVisible();
    await page.getByLabel('Situação').selectOption('falhou');
    await page.getByLabel('Tipo').selectOption('confirmacao');
    await page.getByRole('button', { name: 'Filtrar' }).click();
    await expect(page).toHaveURL(/estado=falhou&salao=&tipo=confirmacao|estado=falhou&tipo=confirmacao/);
    await expect(page.getByText(/ mensagens? · Situação: Falhou · Tipo: Confirmação$/)).toBeVisible();
    await page.getByRole('link', { name: 'Limpar filtros' }).first().click();
    await expect(page.getByText('20 de 47 mensagens', { exact: true })).toBeVisible();
  });

  test('reenvio em duas etapas: Reenviar (GET) → Confirmar reenvio (POST) → PRG com o alerta; recarregar não repete', async ({ page }) => {
    await page.goto(`${ROTA}?estado=falhou`);
    await page.getByRole('link', { name: 'Reenviar' }).first().click();
    await expect(page).toHaveURL(/estado=falhou&confirmar=/);
    await expect(page.getByRole('heading', { name: 'Reenviar esta mensagem?' })).toBeVisible();
    await page.getByRole('button', { name: 'Confirmar reenvio' }).click();
    await expect(page).toHaveURL(/estado=falhou&reenvio=ok(#confirmar)?$/);
    await expect(page.getByRole('status').filter({ hasText: 'Reenvio solicitado.' })).toBeVisible();
    await page.reload();
    await expect(page).toHaveURL(/reenvio=ok(#confirmar)?$/);
    await expect(page.getByRole('status').filter({ hasText: 'Reenvio solicitado.' })).toBeVisible();
  });

  test('POST da confirmação de uma mensagem que não é falhou volta com "recusada"', async ({ page }) => {
    await page.goto(`${ROTA}?confirmar=${FALHOU_1}`);
    await page.getByRole('button', { name: 'Confirmar reenvio' }).click();
    await expect(page).toHaveURL(/reenvio=ok(#confirmar)?$/);
    await page.goto(`${ROTA}?confirmar=00000000-0000-4000-8000-000000000001`);
    await expect(page.getByText('Esta mensagem não está mais com falha.')).toBeVisible();
  });

  test('tentativas e paginação por links', async ({ page }) => {
    await page.goto(ROTA);
    await page.getByRole('link', { name: 'Tentativas' }).first().click();
    await expect(page.locator('#detalhe').getByRole('table', { name: 'Tentativas' })).toBeVisible();
    await page.goto(ROTA);
    await page.getByRole('link', { name: 'Próxima' }).click();
    await expect(page).toHaveURL(/pagina=2/);
    await expect(page.getByText('20 de 47 mensagens', { exact: true })).toBeVisible();
  });

  test('auditoria: filtros por GET (com os campos de data vazios) e <details> nativo', async ({ page }) => {
    await page.goto(`${ROTA}?vista=auditoria`);
    await page.getByLabel('Ação', { exact: true }).selectOption('mensagem.reenviar');
    await page.getByRole('button', { name: 'Filtrar' }).click();
    await expect(page).toHaveURL(/acao=mensagem\.reenviar/);
    await expect(page.getByText(/Ação: Mensagem reenviada$/)).toBeVisible();
    const resumo = page.getByText(/^Ver alterações \(/).first();
    await resumo.click();
    await expect(page.getByText('Depois:').first()).toBeVisible();
    await page.getByText('Ver JSON completo').first().click();
    await expect(page.locator('pre').first()).toBeVisible();
  });

  test('assinatura do salão: payload em <details> nativo', async ({ page }) => {
    await page.goto(`${ROTA}?vista=assinatura`);
    await expect(page.getByRole('table', { name: 'Eventos recebidos' })).toBeVisible();
    await page.getByText('Ver payload').first().click();
    await expect(page.getByText('Ver JSON completo').first()).toBeVisible();
  });
});
