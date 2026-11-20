import { expect, test, type Page } from '@playwright/test';

import { analisarComAxe, semRolagemHorizontal } from './suporte/vitrine';

// D-012 CA-18 e CA-19 (E2E sem banco, D-13): /recuperar-senha e /redefinir-senha em viewport móvel,
// só pelo teclado, sem rolagem horizontal e com axe zero violações; envio sem JS; cabeçalho
// Referrer-Policy. Nada aqui toca o PostgreSQL: o e-mail inválido é recusado pela validação antes do
// banco, e um token fora do formato é recusado sem consulta. O fluxo com banco está na integração.

/** Token fora do formato (42 caracteres + '!'): recusado sem consultar o banco. */
const TOKEN_MALFORMADO = `${'T'.repeat(42)}!`;

/** Nome do campo (ou texto do botão/link) do elemento focado. */
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

test.describe('CA-19: /recuperar-senha em viewport móvel', () => {
  test('CA-19: 200, h1, campo rotulado, só com Tab (E-mail → Enviar link → Voltar para entrar), sem rolagem e axe', async ({ page }) => {
    const resposta = await page.goto('/recuperar-senha');
    expect(resposta?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1, name: 'Recuperar senha' })).toBeVisible();
    const email = page.getByLabel('E-mail', { exact: false }).first();
    await expect(email).toHaveAttribute('type', 'email');
    await expect(email).toHaveAttribute('autocomplete', 'email');
    await expect(page.getByRole('link', { name: 'Voltar para entrar' })).toHaveAttribute('href', '/entrar');
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await tabAte(page, 'input:email');
    for (const passo of ['button:Enviar link', 'a:Voltar para entrar']) {
      await page.keyboard.press('Tab');
      expect(await focado(page)).toBe(passo);
    }
    await semRolagemHorizontal(page, '/recuperar-senha');
    await analisarComAxe(page, '/recuperar-senha');
  });

  test('CA-19: e-mail inválido enviado pelo teclado → erro ligado ao campo, sem violações do axe', async ({ page }) => {
    await page.goto('/recuperar-senha');
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await tabAte(page, 'input:email');
    await page.keyboard.type('sem-arroba');
    await page.keyboard.press('Enter');
    const texto = page.getByText('Informe um e-mail válido.');
    await expect(texto).toBeVisible();
    const campo = page.getByLabel('E-mail', { exact: false }).first();
    await expect(campo).toHaveAttribute('aria-invalid', 'true');
    const idErro = await texto.evaluate((e) => e.closest('p')!.id);
    expect(await campo.getAttribute('aria-describedby')).toContain(idErro);
    await analisarComAxe(page, '/recuperar-senha com erro');
  });

  test('CA-19: "Esqueci minha senha" em /entrar leva a /recuperar-senha (200)', async ({ page }) => {
    await page.goto('/entrar');
    const resposta = page.waitForResponse((r) => new URL(r.url()).pathname === '/recuperar-senha' && r.request().resourceType() === 'document');
    await page.getByRole('link', { name: 'Esqueci minha senha' }).click();
    expect((await resposta).status()).toBe(200);
    await expect(page).toHaveURL(/\/recuperar-senha$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Recuperar senha' })).toBeVisible();
  });
});

test.describe('CA-6/CA-19: /redefinir-senha recusado (sem banco)', () => {
  for (const url of ['/redefinir-senha', `/redefinir-senha?token=${TOKEN_MALFORMADO}`]) {
    test(`CA-19: ${url} → recusa com link para pedir outro, sem formulário, só com Tab, sem rolagem e axe`, async ({ page }) => {
      const resposta = await page.goto(url);
      expect(resposta?.status()).toBe(200);
      await expect(page.getByRole('heading', { level: 1, name: 'Link inválido' })).toBeVisible();
      // `main`: o anunciador de rotas do Next também tem role=alert (fora do conteúdo).
      await expect(page.getByRole('main').getByRole('alert')).toContainText('Este link de redefinição é inválido, expirou ou já foi usado.');
      await expect(page.locator('form')).toHaveCount(0);
      await expect(page.locator('meta[name="referrer"]')).toHaveCount(0);
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      await tabAte(page, 'a:Pedir um novo link');
      await expect(page.getByRole('link', { name: 'Pedir um novo link' })).toHaveAttribute('href', '/recuperar-senha');
      await semRolagemHorizontal(page, url);
      await analisarComAxe(page, url);
    });
  }
});

test.describe('CA-19: sem JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('CA-19: /recuperar-senha com e-mail inválido sem JS → 200 com o erro do servidor no campo', async ({ page }) => {
    await page.goto('/recuperar-senha');
    await page.getByLabel('E-mail', { exact: false }).first().fill('sem-arroba');
    const resposta = page.waitForResponse((r) => r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Enviar link' }).click();
    expect((await resposta).status()).toBe(200);
    await expect(page.getByText('Informe um e-mail válido.')).toBeVisible();
  });

  test('CA-19: /redefinir-senha com token malformado sem JS → recusa', async ({ page }) => {
    const resposta = await page.goto(`/redefinir-senha?token=${TOKEN_MALFORMADO}`);
    expect(resposta?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1, name: 'Link inválido' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Pedir um novo link' })).toBeVisible();
  });
});

test.describe('CA-18: Referrer-Policy de /redefinir-senha', () => {
  test('strict-origin no documento, com e sem token, e no POST; /recuperar-senha e /entrar sem ele', async ({ request }) => {
    for (const url of ['/redefinir-senha', `/redefinir-senha?token=${TOKEN_MALFORMADO}`]) {
      const r = await request.get(url);
      expect(r.status(), url).toBe(200);
      expect(r.headers()['referrer-policy'], url).toBe('strict-origin');
    }
    const post = await request.post(`/redefinir-senha?token=${TOKEN_MALFORMADO}`, { form: { senha: 'x' } });
    expect(post.headers()['referrer-policy'], 'POST').toBe('strict-origin');
    for (const url of ['/recuperar-senha', '/entrar']) {
      expect((await request.get(url)).headers()['referrer-policy'], url).toBeUndefined();
    }
  });

  test('nenhuma sub-requisição da página leva o token no Referer (só a origem)', async ({ page }) => {
    const referers: string[] = [];
    page.on('request', (r) => {
      const ref = r.headers()['referer'];
      if (ref !== undefined && r.url() !== page.url()) referers.push(ref);
    });
    await page.goto(`/redefinir-senha?token=${TOKEN_MALFORMADO}`);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await page.waitForLoadState('networkidle');
    expect(referers.length).toBeGreaterThan(0);
    for (const ref of referers) {
      expect(ref).not.toContain('T'.repeat(42));
      expect(new URL(ref).pathname).toBe('/');
    }
  });
});
