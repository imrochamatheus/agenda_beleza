import { expect, test, type Page } from '@playwright/test';

import { analisarComAxe, semRolagemHorizontal } from './suporte/vitrine';

// D-031 CA-13: a exclusão em duas etapas só com o teclado (foco visível, foco no título da confirmação),
// aviso de sucesso na cliente removida, axe 4.14.0 sem violações e sem rolagem horizontal em 375×812.
// Roda em /dev/clientes (mesmos componentes das páginas reais, sem banco). Locale en-US de propósito: o
// resultado não pode depender do idioma do navegador.

test.use({ locale: 'en-US' });

async function abrir(page: Page, busca: string) {
  const resposta = await page.goto(`/dev/clientes${busca}`);
  if (resposta?.status() !== 200) {
    throw new Error(`/dev/clientes respondeu ${resposta?.status()}: ligue VITRINE_COMPONENTES=true ou libere a porta do E2E (E2E_PORT, padrão 3000).`);
  }
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

type Focado = { tag: string; texto: string; outline: number; estilo: string };

const focado = (page: Page): Promise<Focado> =>
  page.evaluate(() => {
    const e = document.activeElement as HTMLElement;
    const s = getComputedStyle(e);
    return { tag: e.tagName, texto: (e.textContent ?? '').trim(), outline: parseFloat(s.outlineWidth), estilo: s.outlineStyle };
  });

async function tabAte(page: Page, alvo: (f: Focado) => boolean, limite = 40): Promise<Focado> {
  for (let i = 0; i < limite; i += 1) {
    await page.keyboard.press('Tab');
    const f = await focado(page);
    if (f.tag !== 'BODY') {
      expect(f.estilo, `foco visível em ${f.tag} "${f.texto}"`).not.toBe('none');
      expect(f.outline, `contorno de foco em ${f.tag} "${f.texto}"`).toBeGreaterThan(0);
    }
    if (alvo(f)) return f;
  }
  throw new Error('elemento não alcançado por Tab');
}

test.describe('CA-13: exclusão só com o teclado (375×812)', () => {
  test('detalhe → "Excluir cliente" → confirmação com foco no título → Confirmar → cliente removida com aviso', async ({ page }) => {
    await abrir(page, '?vista=detalhe');
    await tabAte(page, (f) => f.tag === 'A' && f.texto === 'Excluir cliente');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/vista=excluir$/);
    const titulo = page.getByRole('heading', { level: 1, name: 'Excluir cliente' });
    await expect(titulo).toBeFocused();
    expect(await titulo.evaluate((e) => getComputedStyle(e).outlineStyle)).not.toBe('none');
    await expect(page.getByText('Maria Souza')).toBeVisible();
    await expect(page.getByText('Esta ação é irreversível.')).toBeVisible();
    await expect(page.getByText(/não receberá mais avisos/)).toBeVisible();
    await semRolagemHorizontal(page, '/dev/clientes?vista=excluir');

    await tabAte(page, (f) => f.tag === 'BUTTON' && f.texto === 'Confirmar exclusão');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/vista=anonimizada&exclusao=ok$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Cliente removida' })).toBeVisible();
    await expect(page.getByRole('status')).toContainText('Cliente excluída');
    await expect(page.getByRole('link', { name: 'Excluir cliente' })).toHaveCount(0);
  });

  test('Cancelar (link) volta ao detalhe sem alterar nada', async ({ page }) => {
    await abrir(page, '?vista=excluir');
    await tabAte(page, (f) => f.tag === 'A' && f.texto === 'Cancelar');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/vista=detalhe$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Maria Souza' })).toBeVisible();
  });
});

test.describe('CA-13: axe 4.14.0 sem violações e sem rolagem horizontal', () => {
  test('confirmação, detalhe com o link e cliente removida com o aviso', async ({ page }) => {
    for (const busca of ['?vista=excluir', '?vista=detalhe', '?vista=anonimizada&exclusao=ok']) {
      await abrir(page, busca);
      await analisarComAxe(page, `/dev/clientes${busca}`);
      await semRolagemHorizontal(page, `/dev/clientes${busca}`);
    }
  });
});
