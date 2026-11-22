import { expect, test, type Page } from '@playwright/test';

import { analisarComAxe, semRolagemHorizontal } from './suporte/vitrine';

// D-039 CA-15 (E2E sem banco): /dev/convite (o MESMO componente de /convite/[token], ação só de validação)
// e /convite/<token malformado> (recusado sem consultar o banco), em viewport móvel, só pelo teclado, sem
// rolagem horizontal, com axe zero violações e com os cabeçalhos da rota. Nada aqui toca o PostgreSQL.

/** Token fora do formato (42 caracteres + '!'): recusado sem consultar o banco. */
const TOKEN_MALFORMADO = `${'T'.repeat(42)}!`;

const focado = (page: Page) =>
  page.evaluate(() => {
    const e = document.activeElement as HTMLElement | null;
    if (!e || e === document.body) return '';
    if (e.tagName === 'BUTTON' || e.tagName === 'A') return `${e.tagName.toLowerCase()}:${(e.textContent ?? '').trim()}`;
    return `${e.tagName.toLowerCase()}:${e.getAttribute('name') ?? ''}`;
  });

async function tabAte(page: Page, alvo: string) {
  let passos = 0;
  while ((await focado(page)) !== alvo) {
    await page.keyboard.press('Tab');
    passos += 1;
    expect(passos, `${alvo} não foi alcançado por Tab`).toBeLessThan(30);
  }
}

test.describe('CA-15: /dev/convite em viewport móvel', () => {
  test('200, h1, campo rotulado, só com Tab (Senha → Definir senha), sem rolagem e axe', async ({ page }) => {
    const resposta = await page.goto('/dev/convite');
    expect(resposta?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1, name: 'Ativar o seu acesso' })).toBeVisible();
    const senha = page.getByLabel('Senha', { exact: false }).first();
    await expect(senha).toHaveAttribute('type', 'password');
    await expect(senha).toHaveAttribute('autocomplete', 'new-password');
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await tabAte(page, 'input:senha');
    await page.keyboard.press('Tab');
    expect(await focado(page)).toBe('button:Definir senha');
    await semRolagemHorizontal(page, '/dev/convite');
    await analisarComAxe(page, '/dev/convite');
  });

  test('senha curta enviada pelo teclado → erro ligado ao campo; senha válida → "Senha definida" com link para entrar', async ({ page }) => {
    await page.goto('/dev/convite');
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await tabAte(page, 'input:senha');
    await page.keyboard.type('curta');
    await page.keyboard.press('Enter');
    const texto = page.getByText('A senha precisa ter pelo menos 8 caracteres.');
    await expect(texto).toBeVisible();
    const campo = page.getByLabel('Senha', { exact: false }).first();
    await expect(campo).toHaveAttribute('aria-invalid', 'true');
    const idErro = await texto.evaluate((e) => e.closest('p')!.id);
    expect(await campo.getAttribute('aria-describedby')).toContain(idErro);
    await analisarComAxe(page, '/dev/convite com erro');

    await campo.fill('uma-senha-forte-1');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 1, name: 'Senha definida' })).toBeVisible();
    await expect(page.locator('#conteudo').getByRole('link', { name: 'Entrar' })).toHaveAttribute('href', '/entrar');
    await analisarComAxe(page, '/dev/convite com sucesso');
  });

  test('?vista=recusado: recusa sem formulário, sem rolagem e axe', async ({ page }) => {
    await page.goto('/dev/convite?vista=recusado');
    await expect(page.getByRole('heading', { level: 1, name: 'Convite inválido' })).toBeVisible();
    await expect(page.getByRole('alert').filter({ hasText: 'Este convite' })).toContainText('Este convite é inválido, expirou ou já foi usado.');
    await expect(page.locator('form')).toHaveCount(0);
    await semRolagemHorizontal(page, '/dev/convite?vista=recusado');
    await analisarComAxe(page, '/dev/convite?vista=recusado');
  });

  test.describe('com locale en-US', () => {
    test.use({ locale: 'en-US' });
    test('a interface continua em pt-BR e funciona (sem campo de data)', async ({ page }) => {
      await page.goto('/dev/convite');
      await expect(page.getByRole('heading', { level: 1, name: 'Ativar o seu acesso' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Definir senha' })).toBeVisible();
      await expect(page.locator('input[type="date"], input[type="datetime-local"]')).toHaveCount(0);
    });
  });
});

test.describe('CA-15: /convite/<token> recusado (sem banco)', () => {
  test('token malformado → 200 com recusa única, sem formulário, cabeçalhos da rota, sem rolagem e axe', async ({ page }) => {
    const resposta = await page.goto(`/convite/${TOKEN_MALFORMADO}`);
    expect(resposta?.status()).toBe(200);
    const h = resposta!.headers();
    expect(h['referrer-policy']).toBe('strict-origin');
    expect(h['cache-control']).toContain('no-store');
    expect(h['x-robots-tag']).toContain('noindex');
    await expect(page.getByRole('heading', { level: 1, name: 'Convite inválido' })).toBeVisible();
    await expect(page.getByRole('alert').filter({ hasText: 'Este convite' })).toContainText('Peça ao gestor do salão um novo convite.');
    await expect(page.locator('form')).toHaveCount(0);
    expect(await page.content()).not.toContain(TOKEN_MALFORMADO.slice(0, 20) + 'value');
    await semRolagemHorizontal(page, '/convite/<token>');
    await analisarComAxe(page, '/convite/<token malformado>');
  });

  test('o Referrer-Policy da rota nunca é no-referrer', async ({ request }) => {
    const r = await request.get('/convite/x');
    expect(r.headers()['referrer-policy']).toBe('strict-origin');
  });
});
