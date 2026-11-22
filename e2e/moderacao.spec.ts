import { expect, test, type Page } from '@playwright/test';

import { analisarComAxe, semRolagemHorizontal } from './suporte/vitrine';

// D-035 CA-9/CA-10: fila e detalhe da moderação só com o teclado em /dev/moderacao (os MESMOS componentes das
// páginas de /admin, dados em memória, ações que só validam, sem banco), em 375×812 e com o idioma do navegador
// em inglês. Mais o redirecionamento real de /admin/avaliacoes sem sessão (CA-9, independente do banco).

test.use({ locale: 'en-US' });

async function abrir(page: Page, consulta = '') {
  const resposta = await page.goto(`/dev/moderacao${consulta}`);
  if (resposta?.status() !== 200) {
    throw new Error(`/dev/moderacao respondeu ${resposta?.status()}: ligue VITRINE_COMPONENTES=true ou libere a porta do E2E (E2E_PORT, padrão 3000).`);
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

test.describe('CA-10: fila de moderação (375×812)', () => {
  test('estado inicial: três avaliações, datas em UTC, sem rolagem horizontal e sem violações do axe', async ({ page }) => {
    await abrir(page);
    await expect(page.getByRole('heading', { level: 1, name: /Moderação de avaliações/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /Moderar avaliação/ })).toHaveCount(3);
    await expect(page.getByText('20/11/2026 15:30 UTC').first()).toBeVisible();
    await expect(page.getByText('Texto com <b>marcação</b>', { exact: false })).toBeVisible();
    await semRolagemHorizontal(page, '/dev/moderacao');
    await analisarComAxe(page, '/dev/moderacao (fila)');
  });

  test('filtrar por estado só com o teclado', async ({ page }) => {
    await abrir(page);
    await tabAte(page, (f) => f.tag === 'SELECT');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await tabAte(page, (f) => f.tag === 'BUTTON');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/estado=retirada/);
    await expect(page.getByRole('link', { name: /Moderar avaliação/ })).toHaveCount(1);
    await analisarComAxe(page, '/dev/moderacao (filtrada)');
  });

  test('"Só este salão" filtra e "Mostrar todos os salões" limpa', async ({ page }) => {
    await abrir(page);
    await page.getByRole('link', { name: /Só este salão: Espaço Lótus/ }).click();
    await expect(page).toHaveURL(/salao=44444444/);
    await expect(page.getByRole('link', { name: /Moderar avaliação/ })).toHaveCount(1);
    await page.getByRole('link', { name: 'Mostrar todos os salões' }).click();
    await expect(page.getByRole('link', { name: /Moderar avaliação/ })).toHaveCount(3);
  });
});

test.describe('CA-6/CA-12: detalhe e ações (375×812)', () => {
  test('detalhe: denúncias como texto, três formulários, sem rolagem horizontal e sem violações do axe', async ({ page }) => {
    await abrir(page, '?vista=detalhe');
    await expect(page.getByRole('heading', { level: 1, name: 'Moderar avaliação' })).toBeVisible();
    await expect(page.getByText('Ofende a equipe. <i>Sem HTML.</i>')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Arquivar esta denúncia' })).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Arquivar todas as pendentes (2)' })).toBeVisible();
    await semRolagemHorizontal(page, '/dev/moderacao (detalhe)');
    await analisarComAxe(page, '/dev/moderacao (detalhe)');
  });

  test('retirar com motivo inválido pelo teclado mostra o erro; com motivo válido, a confirmação', async ({ page }) => {
    await abrir(page, '?vista=detalhe');
    await tabAte(page, (f) => f.id !== '' && f.tag === 'INPUT' && f.tipo === 'text');
    await page.keyboard.type('fale com a@b.com');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('alert').filter({ hasText: 'Erro:' })).toContainText('não pode conter e-mail nem telefone');
    await analisarComAxe(page, '/dev/moderacao (erro de motivo)');
    await tabAte(page, (f) => f.id !== '' && f.tag === 'INPUT' && f.tipo === 'text');
    await page.keyboard.type('Linguagem ofensiva');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('status')).toContainText('Avaliação retirada');
    await analisarComAxe(page, '/dev/moderacao (retirada)');
  });
});

test.describe('CA-9: sem sessão de admin', () => {
  test('/admin/avaliacoes e o detalhe redirecionam para /admin/entrar (cabeçalhos reais, sem banco)', async ({ page }) => {
    await page.goto('/admin/avaliacoes');
    await expect(page).toHaveURL(/\/admin\/entrar$/);
    await page.goto('/admin/avaliacoes/11111111-1111-4111-8111-111111111111');
    await expect(page).toHaveURL(/\/admin\/entrar$/);
  });
});
