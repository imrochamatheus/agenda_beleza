import { expect, test, type Page } from '@playwright/test';

import { origemE2E } from './suporte/ambiente';
import { analisarComAxe, semRolagemHorizontal } from './suporte/vitrine';

// D-010 CA-18 (tela /entrar: teclado, rótulos, atributos, sem rolagem horizontal e axe) e CA-9 com
// o proxy real. Sem banco: sem cookie, /entrar e o proxy não consultam o PostgreSQL (D-13). Nenhum
// teste envia o formulário (o login de ponta a ponta fica para quando o job e2e tiver banco).

/** Nome do campo (ou texto do botão) do elemento focado. */
const focado = (page: Page) =>
  page.evaluate(() => {
    const e = document.activeElement as HTMLInputElement | HTMLButtonElement | null;
    if (!e || e === document.body) return '';
    return e.tagName === 'BUTTON' ? `button:${(e.textContent ?? '').trim()}` : `${e.tagName.toLowerCase()}:${e.getAttribute('name') ?? ''}`;
  });

test.describe('CA-18: /entrar em viewport móvel', () => {
  test('CA-18: responde 200, sem rolagem horizontal, com título e campos rotulados', async ({ page }) => {
    const resposta = await page.goto('/entrar');
    expect(resposta?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1, name: 'Entrar' })).toBeVisible();
    await semRolagemHorizontal(page, '/entrar');

    const email = page.getByLabel('E-mail');
    const senha = page.getByLabel('Senha');
    await expect(email).toHaveAttribute('type', 'email');
    await expect(email).toHaveAttribute('autocomplete', 'username');
    await expect(senha).toHaveAttribute('type', 'password');
    await expect(senha).toHaveAttribute('autocomplete', 'current-password');
    await expect(page.getByRole('button', { name: 'Entrar' })).toHaveAttribute('type', 'submit');
    await expect(page.getByRole('link', { name: 'Esqueci minha senha' })).toHaveAttribute('href', '/recuperar-senha');
    await expect(page.getByRole('link', { name: 'Criar conta do salão' })).toHaveAttribute('href', '/cadastro');
  });

  test('CA-18: só com Tab, na ordem visual: E-mail → Senha → Entrar', async ({ page }) => {
    await page.goto('/entrar');
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    let passos = 0;
    while ((await focado(page)) !== 'input:email') {
      await page.keyboard.press('Tab');
      passos += 1;
      expect(passos, 'o campo E-mail não foi alcançado por Tab').toBeLessThan(30);
    }
    await page.keyboard.press('Tab');
    expect(await focado(page)).toBe('input:senha');
    await page.keyboard.press('Tab');
    expect(await focado(page)).toBe('button:Entrar');
    // A ordem do Tab segue a ordem visual (de cima para baixo).
    const topos = await Promise.all(
      [page.getByLabel('E-mail'), page.getByLabel('Senha'), page.getByRole('button', { name: 'Entrar' })].map(
        async (l) => (await l.boundingBox())!.y,
      ),
    );
    expect([...topos].sort((x, y) => x - y)).toEqual(topos);
  });

  test('CA-18: axe sem violações (WCAG 2.0/2.1 A e AA)', async ({ page }) => {
    await page.goto('/entrar');
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await analisarComAxe(page, '/entrar');
  });
});

test.describe('CA-9: proxy real do painel', () => {
  test('CA-9: /painel/agenda?x=1 sem cookie termina em /entrar?proximo=%2Fpainel%2Fagenda%3Fx%3D1', async ({ page }) => {
    await page.goto('/painel/agenda?x=1');
    const url = new URL(page.url());
    expect(url.pathname + url.search).toBe('/entrar?proximo=%2Fpainel%2Fagenda%3Fx%3D1');
    await expect(page.locator('input[type="hidden"][name="proximo"]')).toHaveValue('/painel/agenda?x=1');
  });

  test('CA-9: o redirecionamento é 307 e /painel sem cookie também redireciona', async ({ request }) => {
    const r = await request.get('/painel', { maxRedirects: 0 });
    expect(r.status()).toBe(307);
    const destino = new URL(r.headers()['location'], origemE2E());
    expect(destino.pathname + destino.search).toBe('/entrar?proximo=%2Fpainel');
  });
});
