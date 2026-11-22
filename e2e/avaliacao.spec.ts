import { expect, test, type Page } from '@playwright/test';

import { analisarComAxe, semRolagemHorizontal } from './suporte/vitrine';

// D-032 CA-16: formulário de avaliação só com o teclado em /dev/avaliacao (mesmo componente da rota com
// token, ação que só valida, sem banco), em 375×812 e com o idioma do navegador em inglês (nada do
// formulário pode depender do locale): foco visível, nota por setas, erro associado ao campo, axe 4.14.0
// sem violações. E os cabeçalhos reais da rota com token (strict-origin, no-store, noindex).

test.use({ locale: 'en-US' });

async function abrir(page: Page, consulta = '') {
  const resposta = await page.goto(`/dev/avaliacao${consulta}`);
  if (resposta?.status() !== 200) {
    throw new Error(`/dev/avaliacao respondeu ${resposta?.status()}: ligue VITRINE_COMPONENTES=true ou libere a porta do E2E (E2E_PORT, padrão 3000).`);
  }
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

type Focado = { tag: string; id: string; tipo: string; outline: number; estilo: string };
const focado = (page: Page): Promise<Focado> =>
  page.evaluate(() => {
    const e = document.activeElement as HTMLInputElement;
    const s = getComputedStyle(e);
    return { tag: e.tagName, id: e.id, tipo: e.type ?? '', outline: parseFloat(s.outlineWidth), estilo: s.outlineStyle };
  });

async function tabAte(page: Page, alvo: (f: Focado) => boolean, limite = 40): Promise<Focado> {
  for (let i = 0; i < limite; i += 1) {
    await page.keyboard.press('Tab');
    const f = await focado(page);
    if (f.tag !== 'BODY') {
      expect(f.estilo, `foco visível em ${f.tag}#${f.id}`).not.toBe('none');
      expect(f.outline, `contorno em ${f.tag}#${f.id}`).toBeGreaterThan(0);
    }
    if (alvo(f)) return f;
  }
  throw new Error('elemento não alcançado por Tab');
}

test.describe('CA-16: avaliação só com o teclado (375×812)', () => {
  test('estado inicial: cinco notas, comentário e aceite; sem rolagem horizontal e sem violações do axe', async ({ page }) => {
    await abrir(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Avalie Salão Demonstração' })).toBeVisible();
    await expect(page.getByRole('radio')).toHaveCount(5);
    await expect(page.getByRole('checkbox')).not.toBeChecked();
    await semRolagemHorizontal(page, '/dev/avaliacao');
    await analisarComAxe(page, '/dev/avaliacao (inicial)');
  });

  test('enviar vazio pelo teclado: erros associados aos campos, valores preservados, axe sem violações', async ({ page }) => {
    await abrir(page);
    await tabAte(page, (f) => f.tag === 'TEXTAREA');
    await page.keyboard.type('meu comentário');
    await tabAte(page, (f) => f.tag === 'BUTTON');
    await page.keyboard.press('Enter');

    const aceite = page.getByRole('checkbox');
    await expect(aceite).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#avaliar-nota-erro')).toContainText('Escolha uma nota de 1 a 5.');
    await expect(page.getByRole('group', { name: /Nota de 1 a 5/ })).toHaveAttribute('aria-describedby', 'avaliar-nota-erro');
    await expect(page.getByLabel(/Comentário/)).toHaveValue('meu comentário');
    await semRolagemHorizontal(page, '/dev/avaliacao (erro)');
    await analisarComAxe(page, '/dev/avaliacao (com erro)');
  });

  test('nota por setas, aceite por Espaço e envio por Enter mostram o sucesso', async ({ page }) => {
    await abrir(page);
    await tabAte(page, (f) => f.tipo === 'radio');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('radio', { name: '5' })).toBeChecked();
    await tabAte(page, (f) => f.tipo === 'checkbox');
    await page.keyboard.press('Space');
    await expect(page.getByRole('checkbox')).toBeChecked();
    await tabAte(page, (f) => f.tag === 'BUTTON');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 1, name: 'Avaliação enviada' })).toBeVisible();
    await expect(page.getByRole('status')).toContainText('nada foi gravado');
    await analisarComAxe(page, '/dev/avaliacao (sucesso)');
  });

  test('o rótulo do aceite é clicável e traz os links da Política', async ({ page }) => {
    await abrir(page);
    await page.getByText('Autorizo a publicação da minha avaliação').click();
    await expect(page.getByRole('checkbox')).toBeChecked();
    await expect(page.getByRole('link', { name: /Política de Privacidade/ }).first()).toHaveAttribute('href', '/privacidade');
  });

  test('link inválido: a mesma resposta uniforme, sem formulário e sem violações do axe', async ({ page }) => {
    await abrir(page, '?vista=invalido');
    await expect(page.getByText('Link inválido ou expirado.')).toBeVisible();
    await expect(page.getByRole('radio')).toHaveCount(0);
    await analisarComAxe(page, '/dev/avaliacao (inválido)');
  });
});

test.describe('CA-16: cabeçalhos da rota com token', () => {
  test('strict-origin, no-store e noindex (cabeçalhos reais, independentes do banco)', async ({ request }) => {
    const r = await request.get(`/um-salao/avaliar/${'a'.repeat(43)}`);
    const h = r.headers();
    expect(h['referrer-policy']).toBe('strict-origin');
    expect(h['cache-control']).toContain('no-store');
    expect(h['x-robots-tag']).toBe('noindex');
  });

  test('rotas sem token não recebem o X-Robots-Tag do convite', async ({ request }) => {
    const r = await request.get('/dev/avaliacao');
    expect(r.headers()['x-robots-tag']).toBeUndefined();
  });
});
