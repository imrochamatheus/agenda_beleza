import { expect, test, type Page } from '@playwright/test';

import { origemE2E } from './suporte/ambiente';
import { analisarComAxe, semRolagemHorizontal } from './suporte/vitrine';

// D-034 CA-13 (e CA-2/CA-4 sem banco): /dev/admin-entrar (vitrine, mesmos componentes do login do admin,
// ação que só valida) e a rota real /admin/entrar com envio vazio, em 375×812, só com o teclado, axe
// 4.14.0 sem violações, cabeçalhos sem cache. Locale en-US de propósito: nada depende do formato local.

test.use({ locale: 'en-US' });

async function abrir(page: Page, caminho: string) {
  const resposta = await page.goto(caminho);
  if (resposta?.status() !== 200) {
    throw new Error(`${caminho} respondeu ${resposta?.status()}: ligue VITRINE_COMPONENTES=true ou libere a porta do E2E (E2E_PORT, padrão 3000).`);
  }
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  return resposta;
}

/** Descrição do elemento focado: `input:email`, `button:Continuar`. */
const focado = (page: Page) =>
  page.evaluate(() => {
    const e = document.activeElement as HTMLInputElement | null;
    if (!e || e === document.body) return '';
    const s = getComputedStyle(e);
    const nome = e.tagName === 'BUTTON' ? `button:${(e.textContent ?? '').trim()}` : `${e.tagName.toLowerCase()}:${e.name}`;
    return `${nome}|${s.outlineStyle}|${parseFloat(s.outlineWidth) > 0}`;
  });

async function tabAte(page: Page, esperado: string) {
  for (let i = 0; i < 30; i += 1) {
    await page.keyboard.press('Tab');
    const f = await focado(page);
    if (f.startsWith(`${esperado}|`)) {
      expect(f.endsWith('|true'), `foco visível em ${esperado}`).toBe(true);
      return;
    }
  }
  throw new Error(`${esperado} não alcançado por Tab`);
}

test.describe('CA-13: /dev/admin-entrar, etapa de senha', () => {
  test('200, título, campos rotulados, sem rolagem horizontal e sem violações do axe', async ({ page }) => {
    await abrir(page, '/dev/admin-entrar');
    await expect(page.getByRole('heading', { level: 1, name: 'Entrar na administração' })).toBeVisible();
    await expect(page.getByLabel('E-mail')).toHaveAttribute('autocomplete', 'username');
    await expect(page.getByLabel('Senha')).toHaveAttribute('type', 'password');
    await semRolagemHorizontal(page, '/dev/admin-entrar');
    await analisarComAxe(page, '/dev/admin-entrar (senha)');
  });

  test('só com Tab: E-mail → Senha → Continuar; envio vazio anuncia os erros e o axe continua limpo', async ({ page }) => {
    await abrir(page, '/dev/admin-entrar');
    await tabAte(page, 'input:email');
    await tabAte(page, 'input:senha');
    await tabAte(page, 'button:Continuar');
    await page.keyboard.press('Enter');
    await expect(page.getByText('Informe seu e-mail.')).toBeVisible();
    await expect(page.getByText('Informe sua senha.')).toBeVisible();
    await analisarComAxe(page, '/dev/admin-entrar (erros)');
  });

  test('formato válido: aviso de demonstração e a senha não volta ao campo', async ({ page }) => {
    await abrir(page, '/dev/admin-entrar');
    await page.getByLabel('E-mail').fill('admin@exemplo.test');
    await page.getByLabel('Senha').fill('uma senha qualquer');
    await page.getByRole('button', { name: 'Continuar' }).click();
    await expect(page.getByText('Demonstração: formato válido, nada foi enviado.')).toBeVisible();
    await expect(page.getByLabel('E-mail')).toHaveValue('admin@exemplo.test');
    await expect(page.getByLabel('Senha')).toHaveValue('');
  });
});

test.describe('CA-13/CA-2: código e cadastro do autenticador', () => {
  test('etapa do código: campo numérico, one-time-code, erro para formato inválido e aceite do formato válido', async ({ page }) => {
    await abrir(page, '/dev/admin-entrar?vista=codigo');
    const campo = page.getByLabel('Código de 6 dígitos');
    await expect(campo).toHaveAttribute('inputmode', 'numeric');
    await expect(campo).toHaveAttribute('autocomplete', 'one-time-code');
    await semRolagemHorizontal(page, '/dev/admin-entrar?vista=codigo');
    await analisarComAxe(page, '/dev/admin-entrar (código)');
    await campo.fill('12ab');
    await page.getByRole('button', { name: 'Verificar' }).click();
    await expect(page.getByText('Informe o código de 6 dígitos.')).toBeVisible();
    await page.getByLabel('Código de 6 dígitos').fill('123 456');
    await page.getByRole('button', { name: 'Verificar' }).click();
    await expect(page.getByText('Demonstração: formato válido, nada foi enviado.')).toBeVisible();
  });

  test('cadastro: QR em SVG acessível, chave em texto, nenhuma requisição externa, axe limpo', async ({ page }) => {
    const externas: string[] = [];
    page.on('request', (r) => {
      if (!r.url().startsWith(`${origemE2E()}/`)) externas.push(r.url());
    });
    await abrir(page, '/dev/admin-entrar?vista=cadastro');
    const qr = page.getByRole('img', { name: 'QR code para o aplicativo autenticador' });
    await expect(qr).toBeVisible();
    const caixa = await qr.boundingBox();
    expect(caixa!.width).toBeGreaterThan(100);
    await expect(page.locator('code')).toHaveText('JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP');
    await semRolagemHorizontal(page, '/dev/admin-entrar?vista=cadastro');
    await analisarComAxe(page, '/dev/admin-entrar (cadastro)');
    expect(externas).toEqual([]);
  });
});

test.describe('CA-13/CA-4: rota real /admin/entrar sem banco', () => {
  test('200 com cabeçalhos sem cache e, com envio vazio, mostra os erros em pt-BR (sem consultar o banco)', async ({ page }) => {
    const resposta = await abrir(page, '/admin/entrar');
    expect(resposta.headers()['cache-control']).toBe('no-store');
    expect(resposta.headers()['x-robots-tag']).toBe('noindex');
    await expect(page.getByRole('heading', { level: 1, name: 'Entrar na administração' })).toBeVisible();
    await page.getByRole('button', { name: 'Continuar' }).click();
    await expect(page.getByText('Informe seu e-mail.')).toBeVisible();
    await expect(page.getByText('Informe sua senha.')).toBeVisible();
    await analisarComAxe(page, '/admin/entrar (erros)');
  });

  test('/admin sem cookie → 307 para /admin/entrar (proxy)', async ({ request }) => {
    const r = await request.get('/admin', { maxRedirects: 0 });
    expect(r.status()).toBe(307);
    expect(new URL(r.headers()['location'], origemE2E()).pathname).toBe('/admin/entrar');
    expect(r.headers()['cache-control']).toBe('no-store');
  });
});
