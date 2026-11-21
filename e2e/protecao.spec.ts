import { expect, test, type Page } from '@playwright/test';

import { analisarComAxe, semRolagemHorizontal } from './suporte/vitrine';

// D-027 CA-5, CA-10, CA-14: verificação humana (Turnstile simulado) na etapa de dados e o aviso de consulta
// limitada, em /dev/reserva (mesmo componente da página real, sem banco), 375×812, com JavaScript.

async function ateOsDados(page: Page) {
  const resposta = await page.goto('/dev/reserva');
  if (resposta?.status() !== 200) throw new Error('/dev/reserva indisponível: ligue VITRINE_COMPONENTES=true.');
  await page.getByRole('checkbox', { name: /Escova/ }).check();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByRole('radio', { name: 'Ana' }).check();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByRole('list').getByRole('link', { name: /\d{2}\/\d{2}\/\d{4}$/ }).first().click();
  await page.getByRole('radio').first().check();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Seus dados' })).toBeVisible();
}

async function preencher(page: Page) {
  await page.getByRole('textbox', { name: /Nome/ }).fill('Maria da Silva');
  await page.getByRole('textbox', { name: /Telefone/ }).fill('(11) 98765-4321');
  await page.getByRole('checkbox', { name: /mensagens da minha reserva/ }).check();
}

const MENSAGEM_HUMANO = 'Não foi possível confirmar que você é uma pessoa. Tente novamente.';

test.describe('Turnstile simulado na etapa de dados', () => {
  test('o controle de teste é acessível, tem o token válido por padrão e passa no axe', async ({ page }) => {
    await ateOsDados(page);
    const controle = page.getByLabel(/Verificação simulada/);
    await expect(controle).toHaveValue('XXXX.DUMMY.TOKEN.XXXX');
    await semRolagemHorizontal(page, 'dados com Turnstile');
    await analisarComAxe(page, 'dados com Turnstile');
  });

  test('token inválido e ausente recusam sem confirmar e preservam os valores; o válido confirma', async ({ page }) => {
    await ateOsDados(page);
    await preencher(page);
    for (const opcao of ['Token inválido', 'Sem token']) {
      await page.getByLabel(/Verificação simulada/).selectOption({ label: opcao });
      await page.getByRole('button', { name: 'Confirmar reserva' }).click();
      await expect(page.getByText(MENSAGEM_HUMANO)).toBeVisible();
      await expect(page.getByText('Reserva confirmada!')).toHaveCount(0);
      await expect(page.getByRole('textbox', { name: /Nome/ })).toHaveValue('Maria da Silva');
    }
    await page.getByLabel(/Verificação simulada/).selectOption({ label: 'Token válido' });
    await page.getByRole('button', { name: 'Confirmar reserva' }).click();
    await expect(page.getByText('Reserva confirmada!')).toBeVisible();
  });

  test('só com o teclado: foca o controle, escolhe e envia', async ({ page }) => {
    await ateOsDados(page);
    await preencher(page);
    const controle = page.getByLabel(/Verificação simulada/);
    await controle.focus();
    await expect(controle).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(controle).toHaveValue('TOKEN.INVALIDO.DE.TESTE');
    await page.getByRole('button', { name: 'Confirmar reserva' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText(MENSAGEM_HUMANO)).toBeVisible();
  });
});

test.describe('CA-14: consulta limitada', () => {
  test('aviso em pt-BR, sem horários e sem violações de acessibilidade', async ({ page }) => {
    const resposta = await page.goto('/dev/reserva?vista=limitado');
    expect(resposta?.status()).toBe(200);
    await expect(page.getByText('Muitas tentativas. Aguarde alguns minutos e tente novamente.')).toBeVisible();
    await expect(page.getByRole('radio')).toHaveCount(0);
    await semRolagemHorizontal(page, 'consulta limitada');
    await analisarComAxe(page, 'consulta limitada');
  });
});
