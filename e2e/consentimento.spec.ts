import { expect, test, type Page } from '@playwright/test';

import { analisarComAxe, semRolagemHorizontal } from './suporte/vitrine';

// D-023 CA-5 e CA-18: as caixas de consentimento só com o teclado em /dev/consentimento (mesmo componente
// da reserva pública, ação que só valida, sem banco): foco visível, rótulo clicável, erro anunciado e
// associado à caixa, estado preservado e axe 4.14.0 sem violações.

async function abrir(page: Page) {
  const resposta = await page.goto('/dev/consentimento');
  if (resposta?.status() !== 200) {
    throw new Error(`/dev/consentimento respondeu ${resposta?.status()}: ligue VITRINE_COMPONENTES=true ou libere a porta do E2E (E2E_PORT, padrão 3000).`);
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

test.describe('CA-5/CA-18: consentimento só com o teclado (375×812)', () => {
  test('estado inicial: duas caixas desmarcadas, links alcançáveis, sem rolagem horizontal e sem violações do axe', async ({ page }) => {
    await abrir(page);
    await expect(page.getByRole('checkbox')).toHaveCount(2);
    await expect(page.locator('#consentimento-mensagens')).not.toBeChecked();
    await expect(page.locator('#consentimento-convite')).not.toBeChecked();
    await expect(page.getByRole('link', { name: /Termos de Uso/ }).first()).toHaveAttribute('target', '_blank');
    await semRolagemHorizontal(page, '/dev/consentimento');
    await analisarComAxe(page, '/dev/consentimento (inicial)');
  });

  test('enviar só o convite pelo teclado: erro anunciado e associado à obrigatória, convite continua marcado', async ({ page }) => {
    await abrir(page);
    await tabAte(page, (f) => f.id === 'consentimento-convite');
    await page.keyboard.press('Space');
    await expect(page.locator('#consentimento-convite')).toBeChecked();
    await tabAte(page, (f) => f.tag === 'BUTTON');
    await page.keyboard.press('Enter');

    const resumo = page.locator('#consentimento-resumo');
    await expect(resumo).toBeFocused();
    await expect(resumo).toHaveAttribute('role', 'alert');
    await expect(resumo).toContainText('Para reservar, aceite os Termos');
    const caixa = page.locator('#consentimento-mensagens');
    await expect(caixa).toHaveAttribute('aria-invalid', 'true');
    const ids = ((await caixa.getAttribute('aria-describedby')) ?? '').split(' ').filter(Boolean);
    expect(ids.length).toBeGreaterThan(0);
    await expect(page.locator(`#${ids[0]}`)).toContainText('Para reservar, aceite os Termos');
    await expect(page.locator('#consentimento-convite')).toBeChecked();
    await expect(page.locator('#consentimento-mensagens')).not.toBeChecked();
    await semRolagemHorizontal(page, '/dev/consentimento (erro)');
    await analisarComAxe(page, '/dev/consentimento (com erro)');
  });

  test('o link do resumo leva à caixa; marcar só a obrigatória e enviar mostra o sucesso', async ({ page }) => {
    await abrir(page);
    await page.getByRole('button', { name: 'Reservar' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#consentimento-resumo')).toBeFocused();
    await tabAte(page, (f) => f.tag === 'A');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#consentimento-mensagens$/);
    await page.locator('#consentimento-mensagens').focus();
    await page.keyboard.press('Space');
    await tabAte(page, (f) => f.tag === 'BUTTON');
    await page.keyboard.press('Enter');
    const sucesso = page.locator('#consentimento-sucesso');
    await expect(sucesso).toBeFocused();
    await expect(sucesso).toContainText('Seriam gravadas: mensagens da reserva.');
    await analisarComAxe(page, '/dev/consentimento (sucesso)');
  });

  test('o rótulo inteiro é clicável', async ({ page }) => {
    await abrir(page);
    await page.getByText('Aceito receber, depois do atendimento').click();
    await expect(page.locator('#consentimento-convite')).toBeChecked();
  });
});
