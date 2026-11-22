import { expect, test, type Page } from '@playwright/test';

import { analisarComAxe, semRolagemHorizontal } from './suporte/vitrine';

// D-026 CA-12: o fluxo da página pública de reserva só com o teclado em /dev/reserva (mesmo componente da
// página real, dados em memória, sem banco), em 375×812: sem rolagem horizontal e axe 4.14.0 sem
// violações em cada passo. A variante sem JavaScript está em reserva-publica-sem-js.spec.ts.

async function abrir(page: Page, busca = '') {
  const resposta = await page.goto(`/dev/reserva${busca}`);
  if (resposta?.status() !== 200) {
    throw new Error(`/dev/reserva respondeu ${resposta?.status()}: ligue VITRINE_COMPONENTES=true ou libere a porta do E2E (E2E_PORT, padrão 3000).`);
  }
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

/** Foca o elemento e confere que o foco é visível (contorno), como o Tab o deixaria. */
async function focar(page: Page, alvo: ReturnType<Page['getByRole']>) {
  await alvo.focus();
  await expect(alvo).toBeFocused();
  const contorno = await alvo.evaluate((e) => {
    const s = getComputedStyle(e);
    return { estilo: s.outlineStyle, largura: parseFloat(s.outlineWidth), sombra: s.boxShadow };
  });
  expect(contorno.estilo !== 'none' && contorno.largura > 0 ? true : contorno.sombra !== 'none').toBe(true);
}

async function verificar(page: Page, contexto: string) {
  await semRolagemHorizontal(page, contexto);
  await analisarComAxe(page, contexto);
}

test.describe('CA-12: reserva completa só com o teclado (375×812)', () => {
  test('perfil → serviços → profissional → dia → horário → dados → confirmação', async ({ page }) => {
    await abrir(page);
    await expect(page.getByRole('heading', { level: 1, name: /Studio Bela/ })).toBeVisible();
    await verificar(page, 'perfil e serviços');

    // 1. Serviços: Space marca, Enter no botão envia o GET.
    const escova = page.getByRole('checkbox', { name: /Escova/ });
    await focar(page, escova);
    await page.keyboard.press('Space');
    await expect(escova).toBeChecked();
    await focar(page, page.getByRole('button', { name: 'Continuar' }));
    await page.keyboard.press('Enter');

    // 2. Profissional.
    await expect(page.getByRole('heading', { level: 2, name: 'Profissional' })).toBeVisible();
    await expect(page.getByRole('radio', { name: /Sem preferência/ })).toBeChecked();
    await verificar(page, 'passo profissional');
    await focar(page, page.getByRole('radio', { name: /Sem preferência/ }));
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('radio', { name: 'Ana' })).toBeChecked();
    await page.keyboard.press('ArrowUp');
    await focar(page, page.getByRole('button', { name: 'Continuar' }));
    await page.keyboard.press('Enter');

    // 3. Dia: o primeiro link de dia com horários.
    await expect(page.getByRole('heading', { level: 2, name: 'Escolha o dia' })).toBeVisible();
    await verificar(page, 'passo dia');
    const dia = page.getByRole('list').getByRole('link', { name: /\d{2}\/\d{2}\/\d{4}$/ }).first();
    await focar(page, dia);
    await page.keyboard.press('Enter');

    // 4. Horário.
    await expect(page.getByRole('heading', { level: 2, name: 'Escolha o horário' })).toBeVisible();
    await verificar(page, 'passo horário');
    const primeiro = page.getByRole('radio').first();
    await focar(page, primeiro);
    await page.keyboard.press('Space');
    await expect(primeiro).toBeChecked();
    await focar(page, page.getByRole('button', { name: 'Continuar' }));
    await page.keyboard.press('Enter');

    // 5. Dados: envio vazio mostra erros por campo.
    await expect(page.getByRole('heading', { level: 2, name: 'Seus dados' })).toBeVisible();
    await verificar(page, 'passo dados');
    await focar(page, page.getByRole('button', { name: 'Confirmar reserva' }));
    await page.keyboard.press('Enter');
    await expect(page.getByText('Informe', { exact: false }).first()).toBeVisible();
    await expect(page.getByRole('alert').or(page.getByText('Erro:').first()).first()).toBeVisible();
    await verificar(page, 'passo dados com erros');

    // Preenche só com o teclado e confirma.
    await page.getByRole('textbox', { name: /Nome/ }).fill('Maria da Silva');
    await page.getByRole('textbox', { name: /Telefone/ }).fill('(11) 98765-4321');
    const aceite = page.getByRole('checkbox', { name: /mensagens da minha reserva/ });
    await focar(page, aceite);
    await page.keyboard.press('Space');
    await expect(aceite).toBeChecked();
    await focar(page, page.getByRole('button', { name: 'Confirmar reserva' }));
    await page.keyboard.press('Enter');

    await expect(page.getByText('Reserva confirmada!')).toBeVisible();
    await expect(page.getByText('Profissional: Ana')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Sua reserva' }).getByText('Escova', { exact: true })).toBeVisible();
    await verificar(page, 'confirmação');
  });

  test('vista indisponível: aviso, sem formulário, axe sem violações', async ({ page }) => {
    await abrir(page, '?vista=indisponivel');
    await expect(page.getByText('Agendamento indisponível')).toBeVisible();
    await expect(page.locator('form')).toHaveCount(0);
    await verificar(page, 'indisponível');
  });

  test('vista de perfil vazio: sem seções vazias e sem "undefined"/"null"', async ({ page }) => {
    await abrir(page, '?vista=vazio');
    await expect(page.getByRole('heading', { name: 'Endereço' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Equipe' })).toHaveCount(0);
    const texto = await page.locator('main').innerText();
    expect(texto).not.toMatch(/undefined|null/);
    await verificar(page, 'perfil vazio');
  });

  test('parâmetros malformados na URL voltam ao passo anterior, sem erro', async ({ page }) => {
    await abrir(page, '?s=lixo&p=x&data=2026-02-30&h=amanha');
    await expect(page.getByRole('heading', { level: 2, name: 'Serviços' })).toBeVisible();
    await abrir(page, '?s=11111111-1111-4111-8111-111111111111&p=qualquer&data=nao');
    await expect(page.getByRole('heading', { level: 2, name: 'Escolha o dia' })).toBeVisible();
  });
});
