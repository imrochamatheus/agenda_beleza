import { expect, test } from '@playwright/test';

import { abrirSalao, verificarTela } from './suporte/publico';

// D-036 CA-18 e CA-22: salão suspenso manualmente (`suspenso_manual_em`, 3º salão do complemento do E2E): o perfil
// segue visível, mas sem formulário de reserva.

test('CA-18: perfil, fotos e avaliações visíveis; "Agendamento indisponível" e nenhum formulário de reserva', async ({ page }) => {
  await abrirSalao(page, 'e2e-suspenso');
  await expect(page.getByRole('heading', { level: 1, name: 'Salão E2E Suspenso' })).toBeVisible();
  await expect(page.getByText('Agendamento indisponível')).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Avaliações' })).toBeVisible();
  await expect(page.getByText('Paula T.')).toBeVisible();
  await expect(page.getByRole('img').first()).toBeVisible();

  await expect(page.getByRole('button', { name: 'Continuar' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Confirmar reserva' })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: /^Corte\b/ })).toHaveCount(0);
  await verificarTela(page, 'salão suspenso');
});
