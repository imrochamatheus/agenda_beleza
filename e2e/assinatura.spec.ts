import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { analisarComAxe, semRolagemHorizontal } from './suporte/vitrine';

// D-040 CA-12 e D-042 (CA-1, CA-5, CA-11, critérios 5 a 10 e 13 do web-design): tela de assinatura em
// /dev/assinatura (sem banco), os 9 estados, a etapa 2 do cancelamento, o resultado e o histórico de 0 e
// 12 pagamentos; teclado, axe 4.14.0 e sem rolagem horizontal a 375×812. Locale en-US de propósito.

test.use({ locale: 'en-US' });

const ESTADOS = [
  ['sem_assinatura', 'Você ainda não assinou.', ['Assinar'], []],
  ['pendente', 'Assinatura pendente de autorização.', ['Continuar assinatura'], ['Cancelar assinatura']],
  ['em_teste', 'Período de teste até 20/06/2027', [], ['Cancelar assinatura']],
  ['ativa', 'Assinatura ativa.', ['Atualizar meio de pagamento'], ['Cancelar assinatura']],
  ['em_carencia', 'Pagamento não confirmado.', ['Regularizar pagamento'], ['Cancelar assinatura']],
  ['suspensa', 'Assinatura suspensa por falta de pagamento.', ['Regularizar pagamento'], ['Cancelar assinatura']],
  ['cancelada', 'Assinatura cancelada.', [], []],
  ['encerrada', 'Assinatura encerrada.', ['Assinar novamente'], []],
  ['manual', 'Salão suspenso pela administração.', [], []],
] as const;

async function abrir(page: Page, busca: string) {
  const r = await page.goto(`/dev/assinatura${busca}`);
  expect(r?.status(), 'ligue VITRINE_COMPONENTES=true ou libere a porta 3000').toBe(200);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

/** Botões e links da área principal (sem o menu do painel). */
async function acoesDaTela(page: Page) {
  const main = page.getByRole('main');
  return {
    botoes: await main.getByRole('button').allTextContents(),
    links: await main.locator('a').allTextContents(),
  };
}

for (const [estado, frase, botoes, cancelar] of ESTADOS) {
  test(`estado ${estado}: texto, ações, sem rolagem horizontal e axe`, async ({ page }) => {
    await abrir(page, `?situacao=${estado}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Assinatura' })).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 2, name: frase })).toBeVisible();
    const a = await acoesDaTela(page);
    expect(a.botoes).toEqual(botoes);
    expect(a.links.filter((t) => t.trim() === 'Cancelar assinatura')).toEqual(cancelar);
    await semRolagemHorizontal(page, `/dev/assinatura?situacao=${estado}`);
    await analisarComAxe(page, `/dev/assinatura?situacao=${estado}`);
  });
}

test('CA-1: em_teste mostra a data de fim no fuso do salão (23:30 locais) e o valor mensal', async ({ page }) => {
  await abrir(page, '?situacao=em_teste');
  await expect(page.getByRole('main')).toContainText('Período de teste até 20/06/2027');
  await expect(page.getByRole('main')).toContainText(/R\$\s79,00\/mês/);
  await expect(page.locator('dd strong')).toHaveText('20/06/2027');
});

test('histórico com 12 pagamentos e vazio: sem rolagem horizontal e axe, com e sem a etapa 2', async ({ page }) => {
  for (const busca of ['?situacao=ativa&historico=12', '?situacao=ativa&historico=12&cancelar=1', '?situacao=ativa&historico=0', '?situacao=encerrada&historico=12']) {
    await abrir(page, busca);
    await semRolagemHorizontal(page, busca);
    await analisarComAxe(page, busca);
  }
  await abrir(page, '?situacao=ativa&historico=12');
  await expect(page.getByRole('row')).toHaveCount(13);
  await abrir(page, '?situacao=ativa&historico=0');
  await expect(page.getByText('Nenhum pagamento registrado.')).toBeVisible();
});

test('CA-5: a etapa 1 é link GET (nenhum POST), abre a etapa 2 e "Manter assinatura" volta', async ({ page }) => {
  const posts: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST') posts.push(r.url());
  });
  await abrir(page, '?situacao=ativa');
  await page.getByRole('link', { name: 'Cancelar assinatura' }).click();
  await expect(page).toHaveURL(/cancelar=1/);
  await expect(page.getByRole('heading', { level: 2, name: 'Cancelar assinatura?' })).toBeVisible();
  await expect(page.getByText(/Se cancelar, você mantém o acesso até 20\/06\/2027 \(período já pago\)/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Cancelar assinatura' })).toHaveCount(0);
  expect(posts).toEqual([]);
  await analisarComAxe(page, 'etapa 2');
  await page.getByRole('link', { name: 'Manter assinatura' }).click();
  await expect(page).not.toHaveURL(/cancelar=1/);
  await expect(page.getByRole('heading', { level: 2, name: 'Assinatura ativa.' })).toBeVisible();
  expect(posts).toEqual([]);
});

test('só com o teclado: Tab chega à ação primária e ao link de cancelar com foco visível; Enter no link abre a etapa 2', async ({ page }) => {
  await abrir(page, '?situacao=ativa');
  const visitados: { texto: string; contorno: number }[] = [];
  for (let i = 0; i < 60; i += 1) {
    await page.keyboard.press('Tab');
    const f = await page.evaluate(() => {
      const e = document.activeElement as HTMLElement;
      return { texto: (e.textContent ?? '').trim(), contorno: parseFloat(getComputedStyle(e).outlineWidth) };
    });
    visitados.push(f);
    if (f.texto === 'Cancelar assinatura') break;
  }
  const ordem = visitados.map((v) => v.texto);
  expect(ordem.indexOf('Atualizar meio de pagamento')).toBeGreaterThanOrEqual(0);
  expect(ordem.at(-1)).toBe('Cancelar assinatura');
  expect(ordem.indexOf('Atualizar meio de pagamento')).toBe(ordem.length - 2);
  for (const t of ['Atualizar meio de pagamento', 'Cancelar assinatura']) {
    expect(visitados.find((v) => v.texto === t)?.contorno).toBeGreaterThan(0);
  }
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 2, name: 'Cancelar assinatura?' })).toBeVisible();
});

test('etapa 2 por teclado: Sim, cancelar → "Erro de pagamento" (role alert) e a tela segue igual', async ({ page }) => {
  await abrir(page, '?situacao=ativa&cancelar=1');
  const ordem: string[] = [];
  for (let i = 0; i < 60; i += 1) {
    await page.keyboard.press('Tab');
    const texto = await page.evaluate(() => (document.activeElement?.textContent ?? '').trim());
    ordem.push(texto);
    if (texto === 'Sim, cancelar assinatura') break;
  }
  expect(ordem.at(-1)).toBe('Sim, cancelar assinatura');
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => (document.activeElement?.textContent ?? '').trim())).toBe('Manter assinatura');
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Enter');
  const alerta = page.getByRole('main').getByRole('alert');
  await expect(alerta).toContainText('Erro de pagamento:');
  await expect(alerta).toContainText('Nada foi alterado');
  await expect(page.getByRole('heading', { level: 2, name: 'Assinatura ativa.' })).toBeVisible();
  await analisarComAxe(page, 'erro de pagamento');
});

test('Atualizar meio de pagamento e Assinar mostram o erro de pagamento da demonstração', async ({ page }) => {
  await abrir(page, '?situacao=em_carencia');
  await page.getByRole('button', { name: 'Regularizar pagamento' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Erro de pagamento:');
  await abrir(page, '');
  await page.getByRole('button', { name: 'Assinar', exact: true }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Não foi possível falar com o provedor de pagamento');
});

test('resultados da tela (sucesso, já cancelada, mudou, erro) passam no axe e sem rolagem horizontal', async ({ page }) => {
  for (const r of ['cancelada', 'encerrada', 'ja_cancelada', 'mudou', 'erro']) {
    await abrir(page, `?situacao=cancelada&resultado=${r}`);
    await expect(page.getByRole('main').locator('[role="status"], [role="alert"]').first()).toBeVisible();
    await semRolagemHorizontal(page, `resultado=${r}`);
    await analisarComAxe(page, `resultado=${r}`);
  }
});

test('alvos de toque ≥ 2,75 rem nos botões e links de ação', async ({ page }) => {
  await abrir(page, '?situacao=ativa&cancelar=1');
  const alturas = await page.getByRole('main').locator('button, a').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
  const rem = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
  for (const h of alturas) expect(h).toBeGreaterThanOrEqual(2.75 * rem - 0.5);
});
