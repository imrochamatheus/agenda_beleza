import { expect, test, type Page } from '@playwright/test';

import { analisarComAxe, semRolagemHorizontal } from './suporte/vitrine';

// D-020 CA-5 (D-14): horário de funcionamento só com o teclado (Tab/Shift+Tab/Enter/Espaço/setas nos
// rádios), foco visível, resumo de erros e sucesso focados, erros ligados aos campos e axe sem violações.
// Roda em /dev/funcionamento (mesmo formulário da página real, ação que só valida, sem banco).

async function abrir(page: Page, busca = '') {
  const resposta = await page.goto(`/dev/funcionamento${busca}`);
  if (resposta?.status() !== 200) {
    throw new Error(`/dev/funcionamento respondeu ${resposta?.status()}: ligue VITRINE_COMPONENTES=true ou libere a porta 3000.`);
  }
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

type Focado = { tag: string; id: string; texto: string; outline: number; estilo: string };

const focado = (page: Page): Promise<Focado> =>
  page.evaluate(() => {
    const e = document.activeElement as HTMLElement;
    const s = getComputedStyle(e);
    return { tag: e.tagName, id: e.id, texto: (e.textContent ?? '').trim(), outline: parseFloat(s.outlineWidth), estilo: s.outlineStyle };
  });

async function tabAte(page: Page, alvo: (f: Focado) => boolean, limite = 120): Promise<Focado> {
  for (let i = 0; i < limite; i += 1) {
    await page.keyboard.press('Tab');
    const f = await focado(page);
    if (f.tag !== 'BODY') {
      expect(f.estilo, `foco visível em ${f.tag}#${f.id}`).not.toBe('none');
      expect(f.outline, `contorno de foco em ${f.tag}#${f.id}`).toBeGreaterThan(0);
    }
    if (alvo(f)) return f;
  }
  throw new Error('elemento não alcançado por Tab');
}

async function digitar(page: Page, valor: string) {
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type(valor);
}

test.describe('CA-5: funcionamento só com o teclado (viewport 375×812)', () => {
  test('escolhe "Informar" com a seta; 22:00–02:00 → resumo focado; o link leva ao campo; corrige → sucesso focado', async ({ page }) => {
    await abrir(page, '?modo=nao-informado');
    await semRolagemHorizontal(page, '/dev/funcionamento?modo=nao-informado');
    await tabAte(page, (f) => f.id === 'funcionamento-modo');
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('#funcionamento-modo-informar')).toBeChecked();
    // Segunda-feira: abre o <details> com Enter e entra nos campos.
    await tabAte(page, (f) => f.tag === 'SUMMARY' && f.texto.startsWith('Segunda-feira'));
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    expect((await focado(page)).id).toBe('funcionamento-1-0-inicio');
    await page.keyboard.type('22:00');
    await page.keyboard.press('Tab');
    expect((await focado(page)).id).toBe('funcionamento-1-0-fim');
    await page.keyboard.type('02:00');
    await page.keyboard.press('Shift+Tab');
    expect((await focado(page)).id).toBe('funcionamento-1-0-inicio');
    await page.keyboard.press('Enter');

    const resumo = page.locator('#funcionamento-resumo-erros');
    await expect(resumo).toBeFocused();
    await expect(resumo).toContainText('Corrija os campos indicados para salvar o horário de funcionamento.');
    const link = await tabAte(page, (x) => x.tag === 'A');
    expect(link.texto).toContain('Segunda-feira, intervalo 1');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#funcionamento-1-0-inicio$/);
    const inicio = page.locator('#funcionamento-1-0-inicio');
    await expect(inicio).toHaveValue('22:00');
    await expect(inicio).toHaveAttribute('aria-invalid', 'true');
    expect((await inicio.getAttribute('aria-describedby'))!.split(' ')).toContain('funcionamento-1-0-erro');
    await expect(page.locator('#funcionamento-1-0-erro')).toContainText('O fim precisa ser depois do início.');
    await expect(page.locator('#funcionamento-modo-informar')).toBeChecked();

    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    expect((await focado(page)).id).toBe('funcionamento-1-0-inicio');
    await digitar(page, '9:00');
    await page.keyboard.press('Tab');
    await digitar(page, '18:00');
    await page.keyboard.press('Enter');

    const sucesso = page.locator('#funcionamento-sucesso');
    await expect(sucesso).toBeFocused();
    await expect(sucesso.getByRole('status')).toContainText('Horário válido (demonstração: nada foi gravado).');
    await expect(page.locator('#funcionamento-1-0-inicio')).toHaveValue('09:00');
    await expect(page.locator('summary', { hasText: 'Segunda-feira' })).toContainText('09:00–18:00');
    await expect(page.locator('summary', { hasText: 'Terça-feira' })).toContainText('Fechado');
    await semRolagemHorizontal(page, '/dev/funcionamento depois de salvar');
  });

  test('"Não informar" com a seta descarta as linhas: sucesso e campos vazios', async ({ page }) => {
    await abrir(page);
    await tabAte(page, (f) => f.id === 'funcionamento-modo-informar');
    await page.keyboard.press('ArrowUp');
    await expect(page.locator('#funcionamento-modo')).toBeChecked();
    await tabAte(page, (f) => f.tag === 'BUTTON' && f.texto === 'Salvar horário');
    await page.keyboard.press('Enter');
    await expect(page.locator('#funcionamento-sucesso')).toBeFocused();
    await expect(page.locator('#funcionamento-1-0-inicio')).toHaveValue('');
    await expect(page.locator('#funcionamento-modo')).toBeChecked();
  });
});

test.describe('CA-5: axe 4.14.0 sem violações e sem rolagem horizontal', () => {
  test('inicial (também não informado e fechado), com erro e com sucesso', async ({ page }) => {
    for (const busca of ['', '?modo=nao-informado', '?modo=fechado']) {
      await abrir(page, busca);
      await analisarComAxe(page, `/dev/funcionamento${busca}`);
      await semRolagemHorizontal(page, `/dev/funcionamento${busca}`);
    }
    await expect(page.getByText('Todos os dias estão fechados')).toBeVisible();

    await abrir(page);
    await page.locator('summary', { hasText: 'Quarta-feira' }).click();
    await page.locator('#funcionamento-3-1-inicio').fill('09:07');
    await page.locator('#funcionamento-3-1-fim').fill('10:00');
    await page.getByRole('button', { name: 'Salvar horário' }).click();
    await expect(page.locator('#funcionamento-resumo-erros')).toBeFocused();
    await analisarComAxe(page, '/dev/funcionamento (erro)');
    await semRolagemHorizontal(page, '/dev/funcionamento (erro)');

    await abrir(page);
    await page.getByRole('button', { name: 'Salvar horário' }).click();
    await expect(page.locator('#funcionamento-sucesso')).toBeFocused();
    await analisarComAxe(page, '/dev/funcionamento (sucesso)');
    await semRolagemHorizontal(page, '/dev/funcionamento (sucesso)');
  });
});
