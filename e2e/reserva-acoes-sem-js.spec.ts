import { expect, test, type Page } from '@playwright/test';

import { semRolagemHorizontal } from './suporte/vitrine';

// D-030 CA-13 e D-050 CA-36 (sem JavaScript): remarcar, cancelar, "Cancelar todos" e marcar o resultado POR ITEM
// funcionam sem JavaScript. Abrir é GET (`?remarcar=`, `?cancelar=`, `?cancelar=todos`); erros e avisos voltam na
// resposta do POST (200); o sucesso é PRG (`?resultado=…#resultado`). Em /dev/reserva-acoes (sem banco).

test.use({ javaScriptEnabled: false });

async function enviar(page: Page, botao: string) {
  const resposta = page.waitForResponse((r) => r.request().method() === 'POST');
  await page.getByRole('button', { name: botao }).click();
  return resposta;
}

test.describe('CA-36: ações por item sem JavaScript', () => {
  test('remarcar: aviso de encaixe na resposta, valores preservados, confirmação faz o PRG', async ({ page }) => {
    await page.goto('/dev/reserva-acoes');
    await page.getByRole('link', { name: 'Remarcar Escova (09:00)' }).click();
    await expect(page).toHaveURL(/remarcar=item-escova/);
    await expect(page.getByRole('button', { name: 'Remarcar serviço' })).toHaveCount(1);
    await semRolagemHorizontal(page, 'remarcar aberto sem JS');
    await page.getByRole('combobox', { name: 'Profissional' }).selectOption({ label: 'Bia Demonstração' });
    await page.getByRole('textbox', { name: /Hora/ }).fill('19:00');
    expect((await enviar(page, 'Remarcar serviço')).status()).toBe(200);
    await expect(page.locator('#remarcar-aviso-encaixe')).toContainText('Fora da jornada do profissional.');
    await expect(page.getByRole('textbox', { name: /Hora/ })).toHaveValue('19:00');
    await expect(page.getByRole('combobox', { name: 'Profissional' }).locator('option:checked')).toHaveText('Bia Demonstração');

    await page.getByRole('checkbox', { name: 'Confirmo o encaixe' }).check();
    await enviar(page, 'Remarcar serviço');
    await expect(page).toHaveURL(/resultado=remarcado/);
    await expect(page.locator('#resultado')).toContainText('foi remarcado');
  });

  test('remarcar: erro volta na resposta com os valores preservados', async ({ page }) => {
    await page.goto('/dev/reserva-acoes?remarcar=item-escova');
    await page.getByRole('textbox', { name: /Hora/ }).fill('9h');
    expect((await enviar(page, 'Remarcar serviço')).status()).toBe(200);
    await expect(page.locator('#remarcar-resumo-erros')).toBeVisible();
    await expect(page.getByRole('textbox', { name: /Hora/ })).toHaveValue('9h');
  });

  test('cancelar um item: GET abre a confirmação, "Manter serviço" volta, POST cancela', async ({ page }) => {
    await page.goto('/dev/reserva-acoes');
    await page.getByRole('link', { name: 'Cancelar Escova (09:00)' }).click();
    await expect(page.getByRole('group', { name: /^Cancelar Escova \(09:00/ })).toBeVisible();
    await page.getByRole('link', { name: 'Manter serviço' }).click();
    await expect(page.getByRole('button', { name: 'Sim, cancelar este serviço' })).toHaveCount(0);
    await page.getByRole('link', { name: 'Cancelar Escova (09:00)' }).click();
    await enviar(page, 'Sim, cancelar este serviço');
    await expect(page).toHaveURL(/resultado=cancelado/);
    await expect(page.locator('#resultado')).toContainText('Escova (09:00) foi cancelado.');
  });

  test('"Cancelar todos": GET + POST, uma única mensagem', async ({ page }) => {
    await page.goto('/dev/reserva-acoes');
    await page.getByRole('link', { name: 'Cancelar todos os serviços' }).click();
    await expect(page.getByRole('button', { name: 'Sim, cancelar todos' })).toBeVisible();
    await page.getByRole('link', { name: 'Manter serviços' }).click();
    await expect(page.getByRole('button', { name: 'Sim, cancelar todos' })).toHaveCount(0);
    await page.getByRole('link', { name: 'Cancelar todos os serviços' }).click();
    await enviar(page, 'Sim, cancelar todos');
    await expect(page).toHaveURL(/resultado=todos_cancelados/);
    await expect(page.locator('#resultado')).toContainText('2 serviços cancelados.');
  });

  test('marcar "Não compareceu" num item iniciado', async ({ page }) => {
    await page.goto('/dev/reserva-acoes?vista=iniciada');
    await enviar(page, 'Marcar Escova como não compareceu');
    await expect(page).toHaveURL(/resultado=nao_compareceu/);
    await expect(page.locator('#resultado')).toContainText('Escova marcado como não compareceu.');
  });

  test('profissional sem JavaScript: só o próprio item, sem "Cancelar todos"', async ({ page }) => {
    await page.goto('/dev/reserva-acoes?vista=profissional');
    await expect(page.getByRole('list', { name: 'Serviços da reserva' }).locator(':scope > li')).toHaveCount(1);
    await expect(page.getByRole('link', { name: 'Cancelar todos os serviços' })).toHaveCount(0);
    await page.getByRole('link', { name: 'Remarcar Escova (09:00)' }).click();
    await expect(page.getByRole('combobox', { name: 'Profissional' })).toHaveCount(0);
    await semRolagemHorizontal(page, 'profissional remarcando sem JS');
  });
});
