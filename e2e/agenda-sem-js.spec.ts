import { expect, test } from '@playwright/test';

// D-028 CA-14: sem JavaScript, a navegação (dia anterior/próximo/hoje, dia ↔ semana, filtro GET) e abrir/voltar
// do detalhe funcionam, tudo por links e por um formulário GET. Em /dev/agenda, sem banco.

test.use({ javaScriptEnabled: false });

test.describe('CA-14: agenda sem JavaScript', () => {
  test('dia anterior, próximo, hoje, semana e dia', async ({ page }) => {
    await page.goto('/dev/agenda?data=2027-03-02');
    await expect(page.getByRole('heading', { level: 2, name: 'Terça-feira, 02/03/2027' })).toBeVisible();
    await page.getByRole('link', { name: 'Próximo dia' }).click();
    await expect(page).toHaveURL(/data=2027-03-03&visao=dia$/);
    await expect(page.getByRole('heading', { level: 2, name: 'Quarta-feira, 03/03/2027' })).toBeVisible();
    await page.getByRole('link', { name: 'Dia anterior' }).click();
    await page.getByRole('link', { name: 'Dia anterior' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Segunda-feira, 01/03/2027' })).toBeVisible();
    await page.getByRole('link', { name: 'Semana', exact: true }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Semana de 28/02/2027 a 06/03/2027' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Semana', exact: true })).toHaveAttribute('aria-current', 'true');
    await page.getByRole('link', { name: 'Próxima semana' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Semana de 07/03/2027 a 13/03/2027' })).toBeVisible();
    await page.getByRole('link', { name: 'Dia', exact: true }).click();
    await expect(page.getByRole('heading', { level: 2 }).first()).toContainText('/2027');
    await page.getByRole('link', { name: 'Hoje' }).click();
    await expect(page).toHaveURL(/data=\d{4}-\d{2}-\d{2}&visao=dia$/);
    await expect(page.getByRole('link', { name: /Maria Souza/ }).first()).toBeVisible();
  });

  test('filtro por formulário GET preserva a data e a visão', async ({ page }) => {
    await page.goto('/dev/agenda?data=2027-03-02&visao=semana');
    await page.getByRole('combobox', { name: 'Profissional' }).selectOption({ label: 'Bia Demonstração' });
    await page.getByRole('button', { name: 'Filtrar' }).click();
    await expect(page).toHaveURL(/data=2027-03-02&visao=semana&profissional=demo-bia$/);
    await expect(page.getByRole('combobox', { name: 'Profissional' })).toHaveValue('demo-bia');
    await expect(page.getByRole('heading', { level: 2, name: 'Semana de 28/02/2027 a 06/03/2027' })).toBeVisible();
    await page.getByRole('combobox', { name: 'Profissional' }).selectOption({ label: 'Todos os profissionais' });
    await page.getByRole('button', { name: 'Filtrar' }).click();
    await expect(page).not.toHaveURL(/profissional=demo/);
  });

  test('abrir a reserva e voltar para a agenda', async ({ page }) => {
    await page.goto('/dev/agenda');
    await page.getByRole('link', { name: /Maria Souza · Corte feminino · Confirmada/ }).first().click();
    await expect(page).toHaveURL(/reserva=demo-r1$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Reserva' })).toBeVisible();
    await expect(page.getByText('Ana Demonstração')).toBeVisible();
    await page.getByRole('link', { name: 'Voltar para a agenda' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Agenda' })).toBeVisible();
  });

  test('profissional desconhecido → 404', async ({ page }) => {
    const r = await page.goto('/dev/agenda?profissional=nao-existe');
    expect(r?.status()).toBe(404);
  });
});
