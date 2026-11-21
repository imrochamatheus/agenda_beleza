import { expect, test, type Page } from '@playwright/test';

import { analisarComAxe, semRolagemHorizontal } from './suporte/vitrine';

// D-022 CA-17/CA-18: busca, lista, paginação e edição da cliente só com o teclado, foco visível em cada
// parada, resumo de erros e sucesso focados, erros ligados aos campos e axe sem violações. Roda em
// /dev/clientes (mesmos componentes das páginas reais, dados fixos, ação que só valida, sem banco).

async function abrir(page: Page, busca = '') {
  const resposta = await page.goto(`/dev/clientes${busca}`);
  if (resposta?.status() !== 200) {
    throw new Error(`/dev/clientes respondeu ${resposta?.status()}: ligue VITRINE_COMPONENTES=true ou libere a porta 3000.`);
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

async function digitar(page: Page, valor: string) {
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type(valor);
}

test.describe('CA-17: busca, lista e paginação só com o teclado (viewport 375×812)', () => {
  test('digita a busca, Enter envia; o resultado é focável; Enter no nome abre o detalhe', async ({ page }) => {
    await abrir(page);
    await semRolagemHorizontal(page, '/dev/clientes');
    await expect(page.getByRole('status')).toHaveText('25 clientes · página 1 de 2');
    await tabAte(page, (f) => f.id === 'clientes-busca');
    await page.keyboard.type('JÚLIA');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\?q=J%C3%9ALIA$/);
    await expect(page.getByRole('status')).toHaveText('1 cliente');
    await expect(page.locator('#clientes-busca')).toHaveValue('JÚLIA');
    const f = await tabAte(page, (x) => x.tag === 'A' && x.texto === 'Ana Júlia');
    expect(f.texto).toBe('Ana Júlia');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/vista=detalhe/);
    await expect(page.getByRole('heading', { level: 1, name: 'Maria Souza' })).toBeVisible();
  });

  test('busca por telefone e sem resultado; "Limpar busca" volta à lista completa', async ({ page }) => {
    await abrir(page, '?q=%2855%29%2011');
    await expect(page.getByRole('status')).toContainText('cliente');
    await abrir(page, '?q=xyz');
    await expect(page.getByRole('heading', { name: 'Nenhuma cliente encontrada.' })).toBeVisible();
    await tabAte(page, (f) => f.tag === 'A' && f.texto === 'Limpar busca');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/dev\/clientes$/);
    await expect(page.getByRole('status')).toHaveText('25 clientes · página 1 de 2');
  });

  test('Próxima e Anterior por teclado; a página além da última tem link para a primeira', async ({ page }) => {
    await abrir(page);
    await tabAte(page, (f) => f.tag === 'A' && f.texto === 'Próxima');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/pagina=2$/);
    await expect(page.getByRole('status')).toHaveText('25 clientes · página 2 de 2');
    await expect(page.locator('main li > a')).toHaveCount(5);
    await tabAte(page, (f) => f.tag === 'A' && f.texto === 'Anterior');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/dev\/clientes$/);
    await abrir(page, '?pagina=9');
    await expect(page.getByText('Esta página não tem clientes.')).toBeVisible();
    await tabAte(page, (f) => f.tag === 'A' && f.texto === 'Voltar para a primeira página');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/dev\/clientes$/);
  });
});

test.describe('CA-17/CA-18: edição só com o teclado', () => {
  test('dois erros: resumo focado com links por campo; o link leva ao campo; corrige e salva → sucesso focado', async ({ page }) => {
    await abrir(page, '?vista=detalhe');
    await semRolagemHorizontal(page, '/dev/clientes?vista=detalhe');
    await tabAte(page, (f) => f.id === 'cliente-nome');
    await digitar(page, 'A');
    await page.keyboard.press('Tab');
    expect((await focado(page)).id).toBe('cliente-telefone');
    await digitar(page, 'abc');
    await page.keyboard.press('Enter');

    const resumo = page.locator('#cliente-resumo-erros');
    await expect(resumo).toBeFocused();
    await expect(resumo).toContainText('Corrija os campos indicados para salvar.');
    await expect(resumo.getByRole('link')).toHaveCount(2);
    const f = await tabAte(page, (x) => x.tag === 'A');
    expect(f.texto).toContain('Nome:');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#cliente-nome$/);
    const nome = page.locator('#cliente-nome');
    await expect(nome).toHaveValue('A');
    await expect(nome).toHaveAttribute('aria-invalid', 'true');
    expect((await nome.getAttribute('aria-describedby'))!.split(' ')).toContain('cliente-nome-erro');
    await expect(page.locator('#cliente-nome-erro')).toContainText('de 2 a 100 caracteres');
    await expect(page.locator('#cliente-telefone')).toHaveValue('abc');
    await expect(page.locator('#cliente-telefone-erro')).toContainText('Informe um telefone brasileiro com DDD');

    await digitar(page, 'Maria Lima');
    await page.keyboard.press('Tab');
    await digitar(page, '21 91234-5678');
    await page.keyboard.press('Enter');
    const sucesso = page.locator('#cliente-sucesso');
    await expect(sucesso).toBeFocused();
    await expect(sucesso.getByRole('status')).toContainText('Cliente atualizada.');
    await expect(page.locator('#cliente-nome')).toHaveValue('Maria Lima');
    await expect(page.locator('#cliente-telefone')).toHaveValue('(21) 91234-5678');
  });

  test('telefone de outra cliente: erro no telefone com link para o cadastro dela', async ({ page }) => {
    await abrir(page, '?vista=detalhe');
    await tabAte(page, (f) => f.id === 'cliente-telefone');
    await digitar(page, '(11) 90000-0002');
    await page.keyboard.press('Enter');
    const resumo = page.locator('#cliente-resumo-erros');
    await expect(resumo).toBeFocused();
    await expect(resumo).toContainText('Este telefone já pertence a outra cliente do salão.');
    await expect(resumo.getByRole('link', { name: 'Ver cadastro de Yara Demonstração' })).toBeVisible();
    await expect(page.locator('#cliente-nome')).not.toHaveAttribute('aria-invalid', 'true');
  });
});

test.describe('CA-17: axe 4.14.0 sem violações e sem rolagem horizontal', () => {
  test('lista, lista vazia, página 2, detalhe, erro, sucesso e cliente removida', async ({ page }) => {
    for (const busca of ['', '?q=xyz', '?pagina=2', '?pagina=9', '?vista=detalhe', '?vista=anonimizada']) {
      await abrir(page, busca);
      await analisarComAxe(page, `/dev/clientes${busca}`);
      await semRolagemHorizontal(page, `/dev/clientes${busca}`);
    }

    await abrir(page, '?vista=detalhe');
    await page.locator('#cliente-nome').fill('A');
    await page.locator('#cliente-telefone').fill('abc');
    await page.getByRole('button', { name: 'Salvar alterações' }).click();
    await expect(page.locator('#cliente-resumo-erros')).toBeFocused();
    await analisarComAxe(page, '/dev/clientes (erro)');
    await semRolagemHorizontal(page, '/dev/clientes (erro)');

    await page.locator('#cliente-nome').fill('Maria Lima');
    await page.locator('#cliente-telefone').fill('(21) 91234-5678');
    await page.getByRole('button', { name: 'Salvar alterações' }).click();
    await expect(page.locator('#cliente-sucesso')).toBeFocused();
    await analisarComAxe(page, '/dev/clientes (sucesso)');
    await semRolagemHorizontal(page, '/dev/clientes (sucesso)');
  });
});
