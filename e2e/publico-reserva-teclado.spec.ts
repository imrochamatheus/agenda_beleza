import { expect, test, type Locator, type Page } from '@playwright/test';

import { reservasDoTelefone, telefoneUnico } from './suporte/fixtures';
import { semRolagemHorizontal } from './suporte/vitrine';
import { verificarTela } from './suporte/publico';

// D-036 CA-19 e CA-22: o fluxo inteiro SÓ com o teclado (Tab, Space, Enter, setas), na página pública real
// (/e2e-reservas-2), 375×812 (isMobile, hasTouch). Cada passo: sem rolagem horizontal e axe sem violações.

/** Tab até o elemento ganhar o foco (o foco precisa ser alcançável pelo teclado). */
async function tabAte(page: Page, alvo: Locator, limite = 120) {
  for (let i = 0; i < limite; i += 1) {
    await page.keyboard.press('Tab');
    if (await alvo.evaluate((e) => e === document.activeElement)) return;
  }
  throw new Error('elemento não alcançado por Tab');
}

test('CA-19: reserva completa só com o teclado, sem rolagem horizontal em nenhuma etapa', async ({ page }) => {
  const telefone = telefoneUnico();
  await page.goto('/e2e-reservas-2');
  await expect(page.getByRole('heading', { level: 1, name: 'Salão E2E 2' })).toBeVisible();
  await semRolagemHorizontal(page, 'perfil');

  // 1. Serviços: Tab até o checkbox, Space marca; Tab até "Continuar", Enter envia.
  const corte = page.getByRole('checkbox', { name: /^Corte\b/ });
  await tabAte(page, corte);
  await page.keyboard.press('Space');
  await expect(corte).toBeChecked();
  await tabAte(page, page.getByRole('button', { name: 'Continuar' }));
  await page.keyboard.press('Enter');

  // 2. Profissional: o rádio "Sem preferência" já vem marcado; Enter no botão avança.
  await expect(page.getByRole('heading', { level: 2, name: 'Profissional' })).toBeVisible();
  await verificarTela(page, 'passo profissional');
  await tabAte(page, page.getByRole('radio', { name: /Sem preferência/ }));
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('radio', { name: 'Ana' })).toBeChecked();
  await tabAte(page, page.getByRole('button', { name: 'Continuar' }));
  await page.keyboard.press('Enter');

  // 3. Dia: Tab até o primeiro link de dia, Enter.
  await expect(page.getByRole('heading', { level: 2, name: 'Escolha o dia' })).toBeVisible();
  await verificarTela(page, 'passo dia');
  await tabAte(page, page.getByRole('list').getByRole('link', { name: /\d{2}\/\d{2}\/\d{4}$/ }).first());
  await page.keyboard.press('Enter');

  // 4. Horário: Tab até o primeiro horário, Space marca.
  await expect(page.getByRole('heading', { level: 2, name: 'Escolha o horário' })).toBeVisible();
  await verificarTela(page, 'passo horário');
  const horario = page.getByRole('radio').first();
  await tabAte(page, horario);
  await page.keyboard.press('Space');
  await expect(horario).toBeChecked();
  await tabAte(page, page.getByRole('button', { name: 'Continuar' }));
  await page.keyboard.press('Enter');

  // 5. Dados: digita nos campos focados por Tab, marca o consentimento com Space e confirma com Enter.
  await expect(page.getByRole('heading', { level: 2, name: 'Seus dados' })).toBeVisible();
  await verificarTela(page, 'passo dados');
  await tabAte(page, page.getByRole('textbox', { name: /Nome/ }));
  await page.keyboard.type('Teclado Teste');
  await page.keyboard.press('Tab');
  await page.keyboard.type(telefone.digitado);
  const aceite = page.getByRole('checkbox', { name: /mensagens da minha reserva/ });
  await tabAte(page, aceite);
  await page.keyboard.press('Space');
  await expect(aceite).toBeChecked();
  await tabAte(page, page.getByRole('button', { name: 'Confirmar reserva' }));
  await page.keyboard.press('Enter');

  await expect(page.getByText('Reserva confirmada!')).toBeVisible();
  await verificarTela(page, 'confirmação');
  const reservas = await reservasDoTelefone('e2e-reservas-2', telefone.e164);
  expect(reservas).toHaveLength(1);
  expect(reservas[0]!.status).toBe('confirmado');
});
