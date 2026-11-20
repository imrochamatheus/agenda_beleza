import { expect, test, type Page } from '@playwright/test';

import { analisarComAxe, semRolagemHorizontal } from './suporte/vitrine';

// D-020 CA-5 (D-14): perfil público só com o teclado (Tab/Shift+Tab/Enter/Espaço), foco visível em cada
// parada, resumo de erros e sucesso focados, erros ligados aos campos e axe sem violações. Roda em
// /dev/perfil (mesmo formulário da página real, ação que só valida, sem banco).

async function abrir(page: Page, busca = '') {
  const resposta = await page.goto(`/dev/perfil${busca}`);
  if (resposta?.status() !== 200) {
    throw new Error(`/dev/perfil respondeu ${resposta?.status()}: ligue VITRINE_COMPONENTES=true ou libere a porta 3000.`);
  }
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

type Focado = { tag: string; id: string; texto: string; outline: number; estilo: string; tipo: string };

const focado = (page: Page): Promise<Focado> =>
  page.evaluate(() => {
    const e = document.activeElement as HTMLElement;
    const s = getComputedStyle(e);
    return {
      tag: e.tagName,
      id: e.id,
      texto: (e.textContent ?? '').trim(),
      outline: parseFloat(s.outlineWidth),
      estilo: s.outlineStyle,
      tipo: (e as HTMLInputElement).type ?? '',
    };
  });

/** Tab (até `limite` vezes) até o predicado valer; confere o foco visível em cada parada. */
async function tabAte(page: Page, alvo: (f: Focado) => boolean, limite = 80): Promise<Focado> {
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

test.describe('CA-5: perfil só com o teclado (viewport 375×812)', () => {
  test('endereço incompleto → resumo focado; o link leva ao campo; completa, marca Pix com Espaço e salva → sucesso focado', async ({ page }) => {
    await abrir(page, '?vazio=1');
    await semRolagemHorizontal(page, '/dev/perfil?vazio=1');
    await tabAte(page, (f) => f.id === 'perfil-descricao');
    await page.keyboard.type('Salão de bairro.');
    await expect(page.locator('#perfil-descricao-contador')).toHaveText('16 de 1.000 caracteres');
    await tabAte(page, (f) => f.id === 'perfil-cidade');
    await page.keyboard.type('São Paulo');
    await page.keyboard.press('Shift+Tab');
    expect((await focado(page)).id).toBe('perfil-bairro');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');

    const resumo = page.locator('#perfil-resumo-erros');
    await expect(resumo).toBeFocused();
    await expect(resumo).toContainText('Corrija os campos indicados para salvar o perfil.');
    const link = await tabAte(page, (x) => x.tag === 'A');
    expect(link.texto).toContain('Logradouro (rua, avenida)');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#perfil-logradouro$/);
    const logradouro = page.locator('#perfil-logradouro');
    await expect(logradouro).toHaveAttribute('aria-invalid', 'true');
    await expect(logradouro).toHaveAttribute('aria-describedby', 'perfil-logradouro-erro');
    await expect(page.locator('#perfil-logradouro-erro')).toContainText('deixe o endereço todo em branco');
    await expect(page.locator('#perfil-cidade')).toHaveValue('São Paulo');

    // A partir do alvo do link: Tab vai ao número e Shift+Tab volta ao logradouro.
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    expect((await focado(page)).id).toBe('perfil-logradouro');
    await digitar(page, 'Rua Augusta');
    await page.keyboard.press('Tab');
    await digitar(page, 's/n');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    expect((await focado(page)).id).toBe('perfil-bairro');
    await digitar(page, 'Consolação');
    await tabAte(page, (f) => f.id === 'perfil-uf');
    await page.keyboard.type('SP');
    await expect(page.locator('#perfil-uf')).toHaveValue('SP');
    await page.keyboard.press('Tab');
    expect((await focado(page)).id).toBe('perfil-cep');
    await digitar(page, '01304001');
    await page.keyboard.press('Tab');
    expect((await focado(page)).id).toBe('perfil-telefone');
    await digitar(page, '11987654321');
    await tabAte(page, (f) => f.id === 'perfil-meiosPagamento-pix');
    await page.keyboard.press('Space');
    await expect(page.locator('#perfil-meiosPagamento-pix')).toBeChecked();
    await tabAte(page, (f) => f.tag === 'BUTTON' && f.texto === 'Salvar perfil');
    await page.keyboard.press('Enter');

    const sucesso = page.locator('#perfil-sucesso');
    await expect(sucesso).toBeFocused();
    await expect(sucesso.getByRole('status')).toContainText('Perfil válido (demonstração: nada foi gravado).');
    await expect(page.locator('#perfil-cep')).toHaveValue('01304-001');
    await expect(page.locator('#perfil-telefone')).toHaveValue('(11) 98765-4321');
    await expect(page.locator('#perfil-numero')).toHaveValue('s/n');
    await expect(page.locator('#perfil-meiosPagamento-pix')).toBeChecked();
    await semRolagemHorizontal(page, '/dev/perfil depois de salvar');
  });
});

test.describe('CA-5: axe 4.14.0 sem violações e sem rolagem horizontal', () => {
  test('inicial (também ?vazio=1), com erro e com sucesso', async ({ page }) => {
    for (const busca of ['', '?vazio=1']) {
      await abrir(page, busca);
      await analisarComAxe(page, `/dev/perfil${busca}`);
      await semRolagemHorizontal(page, `/dev/perfil${busca}`);
    }

    await abrir(page);
    await page.locator('#perfil-cep').fill('123');
    await page.locator('#perfil-instagram').fill('pe..rfil');
    await page.locator('#perfil-telefone').fill('0800 123 4567');
    await page.getByRole('button', { name: 'Salvar perfil' }).click();
    await expect(page.locator('#perfil-resumo-erros')).toBeFocused();
    await expect(page.locator('#perfil-cep-erro')).toContainText('Informe o CEP com 8 dígitos');
    await expect(page.locator('#perfil-instagram')).toHaveAttribute('aria-describedby', 'perfil-instagram-ajuda perfil-instagram-erro');
    await analisarComAxe(page, '/dev/perfil (erro)');
    await semRolagemHorizontal(page, '/dev/perfil (erro)');

    await abrir(page);
    await page.getByRole('button', { name: 'Salvar perfil' }).click();
    await expect(page.locator('#perfil-sucesso')).toBeFocused();
    await analisarComAxe(page, '/dev/perfil (sucesso)');
    await semRolagemHorizontal(page, '/dev/perfil (sucesso)');
  });
});
