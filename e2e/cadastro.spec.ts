import { expect, test, type Page } from '@playwright/test';

import { analisarComAxe, semRolagemHorizontal } from './suporte/vitrine';

// D-011 CA-20 (E2E sem banco, D-11): /cadastro e /confirmar-email sem token em viewport móvel, só
// pelo teclado, sem rolagem horizontal e com axe zero violações. O envio vazio do cadastro é
// recusado pela validação do servidor ANTES de qualquer acesso ao banco (RN-7), então cabe no job
// e2e sem PostgreSQL. O fluxo completo com banco é coberto pela integração.

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

test.describe('CA-20: /cadastro em viewport móvel', () => {
  test('CA-20: responde 200, h1, campos rotulados com type/autocomplete, sem rolagem horizontal e axe', async ({ page }) => {
    const resposta = await page.goto('/cadastro');
    expect(resposta?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1, name: 'Criar conta do salão' })).toBeVisible();
    await semRolagemHorizontal(page, '/cadastro');
    const esperados: [string, string, string][] = [
      ['Seu nome', 'text', 'name'],
      ['E-mail', 'email', 'email'],
      ['Senha', 'password', 'new-password'],
      ['Nome do salão', 'text', 'organization'],
    ];
    for (const [rotulo, tipo, auto] of esperados) {
      const campo = page.getByLabel(rotulo, { exact: false }).first();
      await expect(campo).toHaveAttribute('type', tipo);
      await expect(campo).toHaveAttribute('autocomplete', auto);
    }
    await expect(page.getByRole('link', { name: 'Já tenho conta' })).toHaveAttribute('href', '/entrar');
    await analisarComAxe(page, '/cadastro');
  });

  test('CA-20: só com Tab: Seu nome → E-mail → Senha → Nome do salão → Criar conta → Já tenho conta', async ({ page }) => {
    await page.goto('/cadastro');
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await tabAte(page, 'input:nome');
    const ordem = ['input:email', 'input:senha', 'input:nomeSalao', 'button:Criar conta', 'a:Já tenho conta'];
    for (const passo of ordem) {
      await page.keyboard.press('Tab');
      expect(await focado(page)).toBe(passo);
    }
  });

  test('CA-20: envio vazio pelo teclado mostra os 4 erros ligados aos campos, sem rolagem e sem violações do axe', async ({ page }) => {
    await page.goto('/cadastro');
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await tabAte(page, 'button:Criar conta');
    await page.keyboard.press('Enter');
    const erros = [
      ['Seu nome', 'Informe seu nome (de 2 a 100 caracteres).'],
      ['E-mail', 'Informe um e-mail válido.'],
      ['Senha', 'A senha precisa ter pelo menos 8 caracteres.'],
      ['Nome do salão', 'Informe o nome do salão (de 2 a 80 caracteres).'],
    ] as const;
    for (const [rotulo, mensagem] of erros) {
      const texto = page.getByText(mensagem);
      await expect(texto).toBeVisible();
      const campo = page.getByLabel(rotulo, { exact: false }).first();
      await expect(campo).toHaveAttribute('aria-invalid', 'true');
      const idErro = await texto.evaluate((e) => e.closest('p')!.id);
      expect(await campo.getAttribute('aria-describedby')).toContain(idErro);
    }
    await expect(page.getByLabel('Senha', { exact: false }).first()).toHaveValue('');
    await semRolagemHorizontal(page, '/cadastro com erros');
    await analisarComAxe(page, '/cadastro com erros');
  });
});

test.describe('DEF-1/D-15: Referrer-Policy de /confirmar-email', () => {
  test('cabeçalho strict-origin no documento, com e sem token; /cadastro e /entrar sem ele', async ({ request }) => {
    for (const url of ['/confirmar-email', '/confirmar-email?token=invalido']) {
      const r = await request.get(url);
      expect(r.status(), url).toBe(200);
      expect(r.headers()['referrer-policy'], url).toBe('strict-origin');
    }
    for (const url of ['/cadastro', '/entrar']) {
      expect((await request.get(url)).headers()['referrer-policy'], url).toBeUndefined();
    }
  });

  test('nenhuma sub-requisição da página leva o token no Referer (só a origem)', async ({ page }) => {
    const token = 'T'.repeat(43);
    const referers: string[] = [];
    page.on('request', (r) => {
      const ref = r.headers()['referer'];
      if (ref !== undefined && r.url() !== page.url()) referers.push(ref);
    });
    await page.goto(`/confirmar-email?token=${token}`);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await page.waitForLoadState('networkidle');
    expect(referers.length).toBeGreaterThan(0);
    for (const ref of referers) {
      expect(ref).not.toContain(token);
      expect(new URL(ref).pathname).toBe('/');
    }
  });
});

test.describe('CA-20: /confirmar-email sem token', () => {
  test('CA-20: formulário de reenvio por teclado, sem rolagem horizontal e axe', async ({ page }) => {
    const resposta = await page.goto('/confirmar-email');
    expect(resposta?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1, name: 'Reenviar link de confirmação' })).toBeVisible();
    await expect(page.locator('meta[name="referrer"]')).toHaveCount(0);
    const email = page.getByLabel('E-mail', { exact: false }).first();
    await expect(email).toHaveAttribute('type', 'email');
    await expect(email).toHaveAttribute('autocomplete', 'email');
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await tabAte(page, 'input:email');
    await page.keyboard.press('Tab');
    expect(await focado(page)).toBe('button:Reenviar link de confirmação');
    await semRolagemHorizontal(page, '/confirmar-email');
    await analisarComAxe(page, '/confirmar-email');
  });
});
