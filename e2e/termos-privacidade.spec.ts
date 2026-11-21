import { expect, test } from '@playwright/test';

import { VERSAO_TERMOS } from '../src/config/termos';

import { analisarComAxe, semRolagemHorizontal } from './suporte/vitrine';

// D-023 CA-3, CA-6, CA-18: /termos e /privacidade (estáticas, sem banco) alcançadas pelo rodapé, com
// versão, aviso provisório, âncora #avaliacoes por link e por teclado, axe 4.14.0 e sem rolagem horizontal.

const PAGINAS = [
  { caminho: '/termos', titulo: 'Termos de Uso', link: 'Termos de Uso' },
  { caminho: '/privacidade', titulo: 'Política de Privacidade', link: 'Política de Privacidade' },
] as const;

for (const p of PAGINAS) {
  test.describe(`CA-3/CA-18: ${p.caminho}`, () => {
    test('200 pelo link do rodapé, h1, versão e aviso provisório; sem violações do axe nem rolagem horizontal', async ({ page }) => {
      const inicial = await page.goto('/entrar');
      expect(inicial?.status()).toBe(200);
      await page.getByRole('navigation', { name: 'Informações legais' }).getByRole('link', { name: p.link }).click();
      await expect(page).toHaveURL(new RegExp(`${p.caminho}$`));
      await expect(page.getByRole('heading', { level: 1, name: p.titulo })).toBeVisible();
      await expect(page.getByText(`Versão ${VERSAO_TERMOS}`)).toBeVisible();
      await expect(page.getByRole('status')).toContainText('provisório');
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      await semRolagemHorizontal(page, p.caminho);
      await analisarComAxe(page, p.caminho);
    });

    test('responde 200 direto', async ({ request }) => {
      expect((await request.get(p.caminho)).status()).toBe(200);
    });
  });
}

test.describe('CA-6/CA-18: âncora #avaliacoes', () => {
  test('o índice leva à seção por clique e por teclado, com foco visível', async ({ page }) => {
    await page.goto('/privacidade');
    const indice = page.getByRole('navigation', { name: 'Índice do documento' });
    await indice.getByRole('link', { name: 'Avaliações' }).click();
    await expect(page).toHaveURL(/#avaliacoes$/);
    const secao = page.locator('#avaliacoes');
    for (const termo of ['nota', 'comentário', 'primeiro nome', 'não compareceu', 'anonimização', 'moderação', 'denunciar']) {
      await expect(secao).toContainText(termo);
    }

    await page.goto('/privacidade');
    let achou = false;
    for (let i = 0; i < 30 && !achou; i += 1) {
      await page.keyboard.press('Tab');
      const f = await page.evaluate(() => {
        const e = document.activeElement as HTMLElement;
        const s = getComputedStyle(e);
        return { texto: (e.textContent ?? '').trim(), estilo: s.outlineStyle, largura: parseFloat(s.outlineWidth), href: e.getAttribute('href') };
      });
      if (f.href === '#avaliacoes') {
        expect(f.estilo).not.toBe('none');
        expect(f.largura).toBeGreaterThan(0);
        await page.keyboard.press('Enter');
        achou = true;
      }
    }
    expect(achou).toBe(true);
    await expect(page).toHaveURL(/#avaliacoes$/);
  });
});
