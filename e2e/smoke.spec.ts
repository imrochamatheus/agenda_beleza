import { expect, test } from '@playwright/test';

test('a página inicial abre no viewport móvel com o título da marca', async ({ page }) => {
  await page.goto('/');

  expect(page.viewportSize()).toEqual({ width: 375, height: 812 });
  await expect(page.getByRole('heading', { level: 1, name: 'Agenda Beleza' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
  await expect(page).toHaveTitle('Agenda Beleza');
});
