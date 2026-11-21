import { expect, test } from '@playwright/test';

import { analisarComAxe, semRolagemHorizontal } from './suporte/vitrine';

// D-036 CA-10 e CA-11 (#54 CA-2/CA-3): página inicial sem banco.

test('CA-10: o botão de cadastro por teclado leva ao cadastro', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Criar conta do salão' }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/cadastro$/);
});

test('CA-11: 375 px sem rolagem horizontal e sem violações do axe', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('30 dias grátis', { exact: false })).toBeVisible();
  await expect(page.getByText('Sem limite de profissionais', { exact: false })).toBeVisible();
  await semRolagemHorizontal(page, '/');
  await analisarComAxe(page, '/');
});
