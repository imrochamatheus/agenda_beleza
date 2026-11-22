import { expect, test, type Page } from '@playwright/test';

import { analisarComAxe, semRolagemHorizontal } from './suporte/vitrine';

// D-017 CA-19 (D-26): configurações do salão só com o teclado (Tab/Shift+Tab/Enter/setas no <select>),
// foco visível em cada parada, resumo de erros e sucesso focados, erros ligados aos campos e axe sem
// violações. Roda em /dev/configuracoes (mesmos componentes da página real, ações que só validam, sem
// banco): "salvar" e "trocar" aqui exercitam a validação do servidor e o estado sem gravar.

async function abrir(page: Page, busca = '') {
  const resposta = await page.goto(`/dev/configuracoes${busca}`);
  if (resposta?.status() !== 200) {
    throw new Error(`/dev/configuracoes respondeu ${resposta?.status()}: ligue VITRINE_COMPONENTES=true ou libere a porta do E2E (E2E_PORT, padrão 3000).`);
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

/** Tab (até `limite` vezes) até o predicado valer; confere o foco visível em cada parada. */
async function tabAte(page: Page, alvo: (f: Focado) => boolean, limite = 60, tecla = 'Tab'): Promise<Focado> {
  for (let i = 0; i < limite; i += 1) {
    await page.keyboard.press(tecla);
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

test.describe('CA-19: configurações só com o teclado (viewport 375×812)', () => {
  test('regras inválidas por digitação → resumo focado; o link leva ao campo; corrige e salva → sucesso focado', async ({ page }) => {
    await abrir(page);
    await semRolagemHorizontal(page, '/dev/configuracoes');
    await tabAte(page, (f) => f.id === 'config-antecedencia');
    await digitar(page, '99');
    await page.keyboard.press('Tab');
    expect((await focado(page)).id).toBe('config-janela');
    // Shift+Tab volta na ordem visual.
    await page.keyboard.press('Shift+Tab');
    expect((await focado(page)).id).toBe('config-antecedencia');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    expect((await focado(page)).id).toBe('config-intervalo');
    await digitar(page, 'abc');
    await page.keyboard.press('Enter');

    const resumo = page.locator('#config-regras-resumo');
    await expect(resumo).toBeFocused();
    await expect(resumo).toContainText('Corrija os campos indicados para salvar.');
    const f = await tabAte(page, (x) => x.tag === 'A');
    expect(f.texto).toContain('Antecedência mínima (horas)');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#config-antecedencia$/);
    const campo = page.locator('#config-antecedencia');
    await expect(campo).toHaveValue('99');
    await expect(campo).toHaveAttribute('aria-invalid', 'true');
    expect((await campo.getAttribute('aria-describedby'))!.split(' ')).toContain('config-antecedencia-erro');
    await expect(page.locator('#config-antecedencia-erro')).toContainText('de 0 a 72');
    await expect(page.locator('#config-intervalo')).toHaveValue('abc');

    // Corrige pelo teclado: a partir do alvo do link, Tab vai à janela e Shift+Tab volta à antecedência.
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    expect((await focado(page)).id).toBe('config-antecedencia');
    await digitar(page, '3');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    expect((await focado(page)).id).toBe('config-intervalo');
    await digitar(page, '10');
    await page.keyboard.press('Enter');

    const sucesso = page.locator('#config-regras-sucesso');
    await expect(sucesso).toBeFocused();
    await expect(sucesso.getByRole('status')).toContainText('Configurações salvas.');
    await expect(page.locator('#config-antecedencia')).toHaveValue('3');
    await expect(page.locator('#config-intervalo')).toHaveValue('10');
    await semRolagemHorizontal(page, '/dev/configuracoes depois de salvar');
  });

  test('fuso e grade pelo <select> com as setas; salva pelo botão com Enter', async ({ page }) => {
    await abrir(page);
    await tabAte(page, (f) => f.id === 'config-fuso');
    // Select fechado: a seta escolhe a próxima opção (Chromium).
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('#config-fuso')).toHaveValue('America/Araguaina');
    await page.keyboard.press('Tab');
    expect((await focado(page)).id).toBe('config-grade');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('#config-grade')).toHaveValue('30');
    await tabAte(page, (x) => x.tag === 'BUTTON' && x.texto === 'Salvar configurações');
    await page.keyboard.press('Enter');
    await expect(page.locator('#config-regras-sucesso')).toBeFocused();
    await expect(page.locator('#config-fuso')).toHaveValue('America/Araguaina');
    await expect(page.locator('#config-grade')).toHaveValue('30');
  });

  test('slug reservado → erro focado e ligado ao campo; bela-studio → sucesso focado e campo vazio', async ({ page }) => {
    await abrir(page);
    await expect(page.getByText('/studio-exemplo', { exact: true })).toBeVisible();
    await tabAte(page, (f) => f.id === 'config-slug');
    await digitar(page, 'painel');
    await page.keyboard.press('Enter');
    const resumo = page.locator('#config-slug-resumo');
    await expect(resumo).toBeFocused();
    await expect(resumo).toContainText('Este endereço é reservado pelo sistema. Escolha outro.');
    const campo = page.locator('#config-slug');
    await expect(campo).toHaveValue('painel');
    await expect(campo).toHaveAttribute('aria-invalid', 'true');
    await expect(campo).toHaveAttribute('aria-describedby', 'config-slug-ajuda config-slug-erro');

    await tabAte(page, (f) => f.id === 'config-slug');
    await digitar(page, 'Bela-Studio');
    await page.keyboard.press('Enter');
    const sucesso = page.locator('#config-slug-sucesso');
    await expect(sucesso).toBeFocused();
    await expect(sucesso).toContainText('Endereço público alterado.');
    await expect(campo).toHaveValue('');
  });
});

test.describe('CA-19: axe 4.14.0 sem violações e sem rolagem horizontal', () => {
  test('inicial (também ?fuso=alias), com erro e com sucesso', async ({ page }) => {
    for (const busca of ['', '?fuso=alias']) {
      await abrir(page, busca);
      await analisarComAxe(page, `/dev/configuracoes${busca}`);
      await semRolagemHorizontal(page, `/dev/configuracoes${busca}`);
    }
    await expect(page.locator('#config-fuso')).toHaveValue('Brazil/East');

    await abrir(page);
    await page.locator('#config-nome').fill('A');
    await page.locator('#config-janela').fill('0');
    await page.getByRole('button', { name: 'Salvar configurações' }).click();
    await expect(page.locator('#config-regras-resumo')).toBeFocused();
    await page.locator('#config-slug').fill('em-uso');
    await page.getByRole('button', { name: 'Trocar endereço' }).click();
    await expect(page.locator('#config-slug-resumo')).toBeFocused();
    await expect(page.locator('#config-slug-erro')).toContainText('Este endereço já está em uso.');
    await analisarComAxe(page, '/dev/configuracoes (erro)');
    await semRolagemHorizontal(page, '/dev/configuracoes (erro)');

    await abrir(page);
    await page.getByRole('button', { name: 'Salvar configurações' }).click();
    await expect(page.locator('#config-regras-sucesso')).toBeFocused();
    await page.locator('#config-slug').fill('studio-exemplo');
    await page.getByRole('button', { name: 'Trocar endereço' }).click();
    await expect(page.locator('#config-slug-sucesso')).toContainText('Este já é o endereço público do salão.');
    await analisarComAxe(page, '/dev/configuracoes (sucesso)');
    await semRolagemHorizontal(page, '/dev/configuracoes (sucesso)');
  });
});
