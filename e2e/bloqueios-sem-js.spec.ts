import { expect, test, type Page } from '@playwright/test';

// D-016 CA-22 (D-24): os formulários de bloqueio funcionam SEM JavaScript (POST de <form action> antes
// da hidratação; a resposta traz o estado com erros ou com o aviso; a remoção é PRG). Em /dev/bloqueios,
// sem banco: as ações só validam.

test.use({ javaScriptEnabled: false });

function dataLocal(dias: number): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' }).format(
    new Date(Date.now() + dias * 86_400_000),
  );
}

async function salvar(page: Page) {
  const resposta = page.waitForResponse((r) => r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Salvar bloqueio' }).click();
  expect((await resposta).status()).toBe(200);
}

test.describe('CA-22: bloqueios sem JavaScript', () => {
  test('gestor cria com horário e de dia inteiro; o aviso aparece após salvar', async ({ page }) => {
    const dia = dataLocal(4);
    await page.goto('/dev/bloqueios');
    await page.locator('#bloqueio-alvo').selectOption('salao');
    await page.locator('#bloqueio-dataInicio').fill(dia);
    await page.locator('#bloqueio-horaInicio').fill('22:00');
    await page.locator('#bloqueio-dataFim').fill(dataLocal(5));
    await page.locator('#bloqueio-horaFim').fill('02:00');
    await salvar(page);
    await expect(page.getByText(`Bloqueio salvo: ${dia} 22:00 a ${dataLocal(5)} 02:00.`)).toBeVisible();
    await expect(page.getByText('Atenção: estas reservas confirmadas ficam sob o bloqueio.')).toBeVisible();
    await expect(page.getByText('cliente removida', { exact: false })).toBeVisible();

    await page.goto('/dev/bloqueios');
    await page.locator('#bloqueio-alvo').selectOption({ label: 'Ana Demonstração' });
    await page.getByRole('radio', { name: 'Dia inteiro' }).check();
    await page.locator('#bloqueio-dataInicio').fill(dataLocal(8));
    await page.locator('#bloqueio-dataFim').fill(dataLocal(9));
    await salvar(page);
    await expect(page.getByText(`Bloqueio salvo: ${dataLocal(8)} a ${dataLocal(9)}.`)).toBeVisible();
  });

  test('erros do servidor com valores preservados e links do resumo', async ({ page }) => {
    const dia = dataLocal(4);
    await page.goto('/dev/bloqueios');
    await page.locator('#bloqueio-dataInicio').fill(dia);
    await page.locator('#bloqueio-horaInicio').fill('16:00');
    await page.locator('#bloqueio-dataFim').fill(dia);
    await page.locator('#bloqueio-horaFim').fill('14:00');
    await salvar(page);
    await expect(page.getByText('Corrija os campos indicados para salvar o bloqueio.')).toBeVisible();
    await expect(page.locator('#bloqueio-periodo-erro')).toContainText('O fim precisa ser depois do início.');
    await expect(page.getByRole('link', { name: /Período:/ })).toHaveAttribute('href', '#bloqueio-dataInicio');
    await expect(page.locator('#bloqueio-dataInicio')).toHaveValue(dia);
    await expect(page.locator('#bloqueio-horaInicio')).toHaveValue('16:00');
    await expect(page.locator('#bloqueio-horaFim')).toHaveValue('14:00');

    // Período válido sem alvo → erro de alvo.
    await page.locator('#bloqueio-horaInicio').fill('10:00');
    await salvar(page);
    await expect(page.locator('#bloqueio-alvo-erro')).toContainText('Escolha o salão inteiro ou um profissional.');
  });

  test('gestor remove um bloqueio (PRG)', async ({ page }) => {
    await page.goto('/dev/bloqueios');
    await page.getByRole('button', { name: /^Remover bloqueio: Salão inteiro/ }).click();
    await expect(page).toHaveURL(/\/dev\/bloqueios\?remocao=ok&modo=gestor$/);
    await expect(page.getByText('Bloqueio removido.')).toBeVisible();
  });

  test('profissional cria na própria agenda e remove o próprio', async ({ page }) => {
    const dia = dataLocal(3);
    await page.goto('/dev/bloqueios?modo=profissional');
    await expect(page.getByText('O bloqueio vale para a sua agenda.')).toBeVisible();
    await page.locator('#bloqueio-dataInicio').fill(dia);
    await page.locator('#bloqueio-horaInicio').fill('14:00');
    await page.locator('#bloqueio-dataFim').fill(dia);
    await page.locator('#bloqueio-horaFim').fill('16:00');
    await salvar(page);
    await expect(page.getByText(`Bloqueio salvo: ${dia} 14:00 a ${dia} 16:00.`)).toBeVisible();
    await expect(page.getByText('Bloqueio do salão: só o gestor altera.')).toBeVisible();

    await page.getByRole('button', { name: /^Remover bloqueio: Ana Demonstração/ }).click();
    await expect(page).toHaveURL(/\/dev\/bloqueios\?remocao=ok&modo=profissional$/);
    await expect(page.getByText('Bloqueio removido.')).toBeVisible();
  });
});
