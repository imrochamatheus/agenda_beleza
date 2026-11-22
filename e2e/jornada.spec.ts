import { expect, test, type Page } from '@playwright/test';

import { analisarComAxe, semRolagemHorizontal } from './suporte/vitrine';

// D-015 CA-17 (D-11): a jornada só com o teclado, foco visível, resumo de erros focado, erros ligados
// aos campos e axe sem violações. Roda em /dev/jornada (mesmos componentes da página real, ação que
// só valida, sem banco): "salvar" aqui exercita a validação do servidor sem gravar.

const ORDEM = 'O fim precisa ser depois do início.';
const DEMONSTRACAO = 'Jornada válida (demonstração: nada foi gravado).';

async function abrir(page: Page, busca = '') {
  const resposta = await page.goto(`/dev/jornada${busca}`);
  if (resposta?.status() !== 200) {
    throw new Error(`/dev/jornada respondeu ${resposta?.status()}: ligue VITRINE_COMPONENTES=true ou libere a porta do E2E (E2E_PORT, padrão 3000).`);
  }
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

type Focado = { tag: string; id: string; texto: string; outline: number; estilo: string };

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
    };
  });

/** Tab (até `limite` vezes) até o predicado valer; confere o foco visível em cada parada. */
async function tabAte(page: Page, alvo: (f: Focado) => boolean, limite = 60): Promise<Focado> {
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

/** Seleciona o conteúdo do campo focado e digita o novo valor (só teclado). */
async function digitar(page: Page, valor: string) {
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type(valor);
}

test.describe('CA-17: jornada só com o teclado (viewport 375×812)', () => {
  test('CA-17: abre a segunda com Enter, preenche e envia com Enter; o servidor aceita', async ({ page }) => {
    await abrir(page);
    await semRolagemHorizontal(page, '/dev/jornada');
    await tabAte(page, (f) => f.tag === 'SUMMARY' && f.texto.startsWith('Segunda-feira'));
    await page.keyboard.press('Enter');
    await expect(page.locator('details').first()).toHaveAttribute('open', '');
    let f = await tabAte(page, (x) => x.tag === 'INPUT');
    expect(f.id).toBe('jornada-1-0-inicio');
    await digitar(page, '08:00');
    // Shift+Tab volta e Tab avança na ordem visual.
    await page.keyboard.press('Tab');
    expect((await focado(page)).id).toBe('jornada-1-0-fim');
    await page.keyboard.press('Shift+Tab');
    expect((await focado(page)).id).toBe('jornada-1-0-inicio');
    f = await tabAte(page, (x) => x.id === 'jornada-1-2-inicio');
    await digitar(page, '18:00');
    await page.keyboard.press('Tab');
    await digitar(page, '19:00');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('status').filter({ hasText: DEMONSTRACAO })).toBeVisible();
    // Contíguos 13:00–18:00 + 18:00–19:00 voltam unidos (forma canônica).
    await expect(page.locator('#jornada-1-0-inicio')).toHaveValue('08:00');
    await expect(page.locator('#jornada-1-1-fim')).toHaveValue('19:00');
    await expect(page.locator('#jornada-1-2-inicio')).toHaveValue('');
    await semRolagemHorizontal(page, '/dev/jornada depois de salvar');
  });

  test('CA-17: com erro, o foco vai ao resumo; o link leva ao campo, que descreve o erro', async ({ page }) => {
    await abrir(page);
    await tabAte(page, (f) => f.tag === 'SUMMARY' && f.texto.startsWith('Segunda-feira'));
    await page.keyboard.press('Enter');
    await tabAte(page, (x) => x.id === 'jornada-1-2-inicio');
    await digitar(page, '22:00');
    await page.keyboard.press('Tab');
    await digitar(page, '02:00');
    await page.keyboard.press('Enter');

    const resumo = page.locator('#jornada-resumo-erros');
    await expect(resumo).toBeFocused();
    await expect(resumo).toContainText('Corrija os campos indicados para salvar a jornada.');
    const f = await tabAte(page, (x) => x.tag === 'A');
    expect(f.texto).toContain('Segunda-feira, intervalo 3');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#jornada-1-2-inicio$/);
    // O próximo Tab parte do campo de destino (ponto de partida da navegação sequencial).
    await page.keyboard.press('Tab');
    expect((await focado(page)).id).toBe('jornada-1-2-fim');

    const campo = page.locator('#jornada-1-2-inicio');
    await expect(campo).toHaveValue('22:00');
    await expect(campo).toHaveAttribute('aria-invalid', 'true');
    const descricao = (await campo.getAttribute('aria-describedby'))!.split(' ');
    expect(descricao).toContain('jornada-1-2-erro');
    await expect(page.locator('#jornada-1-2-erro')).toContainText(ORDEM);
    await expect(page.locator('details').first()).toHaveAttribute('open', '');
  });
});

test.describe('CA-17: axe 4.14.0 sem violações', () => {
  test('edição, edição com erro, leitura e vazia', async ({ page }) => {
    await abrir(page);
    await analisarComAxe(page, '/dev/jornada (edição)');

    await page.locator('summary').first().click();
    await page.locator('#jornada-1-2-inicio').fill('22:00');
    await page.locator('#jornada-1-2-fim').fill('02:00');
    await page.locator('#jornada-1-3-inicio').fill('9h');
    await page.getByRole('button', { name: 'Salvar jornada' }).click();
    await expect(page.locator('#jornada-resumo-erros')).toBeFocused();
    await analisarComAxe(page, '/dev/jornada (edição com erro)');
    await semRolagemHorizontal(page, '/dev/jornada (edição com erro)');

    for (const modo of ['leitura', 'vazia']) {
      await abrir(page, `?modo=${modo}`);
      await expect(page.getByText('Só o gestor do salão altera a jornada.')).toBeVisible();
      await expect(page.locator('main input')).toHaveCount(0);
      await analisarComAxe(page, `/dev/jornada?modo=${modo}`);
      await semRolagemHorizontal(page, `/dev/jornada?modo=${modo}`);
    }
  });
});
