import { expect, test, type Page } from '@playwright/test';

import { analisarComAxe, semRolagemHorizontal } from './suporte/vitrine';

// D-028 CA-4, CA-7, CA-8, CA-12: agenda da equipe em /dev/agenda (mesmos componentes da página real,
// dados em memória relativos a hoje, sem banco), viewport 375×812: sem rolagem horizontal, axe 4.14.0
// sem violações e navegação só com o teclado. "Terça" fixa (02/03/2027) para as faixas de fundo.

const TERCA = '2027-03-02';

async function abrir(page: Page, busca = '') {
  const resposta = await page.goto(`/dev/agenda${busca}`);
  if (resposta?.status() !== 200) {
    throw new Error(`/dev/agenda respondeu ${resposta?.status()}: ligue VITRINE_COMPONENTES=true ou libere a porta do E2E (E2E_PORT, padrão 3000).`);
  }
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

type Focado = { tag: string; id: string; texto: string; outline: number; estilo: string };

const focado = (page: Page): Promise<Focado> =>
  page.evaluate(() => {
    const e = document.activeElement as HTMLElement;
    const s = getComputedStyle(e);
    return { tag: e.tagName, id: e.id, texto: (e.textContent ?? '').trim(), outline: parseFloat(s.outlineWidth), estilo: s.outlineStyle };
  });

/** Tab até o predicado valer; confere o foco visível em cada parada. */
async function tabAte(page: Page, alvo: (f: Focado) => boolean, limite = 80): Promise<Focado> {
  for (let i = 0; i < limite; i += 1) {
    await page.keyboard.press('Tab');
    const f = await focado(page);
    if (f.tag !== 'BODY') {
      expect(f.estilo, `foco visível em ${f.tag}#${f.id} "${f.texto}"`).not.toBe('none');
      expect(f.outline, `contorno de foco em ${f.tag}#${f.id}`).toBeGreaterThan(0);
    }
    if (alvo(f)) return f;
  }
  throw new Error('elemento não alcançado por Tab');
}

test.describe('CA-4: 375×812 sem rolagem horizontal e sem violações do axe', () => {
  for (const [nome, busca] of [
    ['dia', ''],
    ['dia com filtro', '?profissional=demo-ana'],
    ['semana', '?visao=semana'],
    ['detalhe', '?reserva=demo-r2'],
    ['detalhe anonimizada', '?reserva=demo-r5'],
    ['faixas de fundo (terça)', `?data=${TERCA}`],
  ] as const) {
    test(nome, async ({ page }) => {
      await abrir(page, busca);
      await semRolagemHorizontal(page, `/dev/agenda${busca}`);
      await analisarComAxe(page, `/dev/agenda${busca}`);
    });
  }
});

test.describe('CA-7, CA-8: faixas de fundo com texto, distintas entre si', () => {
  test('salão 08–19 e jornada 09–12/14–18: "Fora do funcionamento" e "Fora da jornada"', async ({ page }) => {
    await abrir(page, `?data=${TERCA}&profissional=demo-ana`);
    await expect(page.getByText('Fora do funcionamento 00:00–08:00')).toBeVisible();
    await expect(page.getByText('Fora do funcionamento 19:00–24:00')).toBeVisible();
    await expect(page.getByText('Fora da jornada 08:00–09:00')).toBeVisible();
    await expect(page.getByText('Fora da jornada 12:00–14:00')).toBeVisible();
    await expect(page.getByText('Fora da jornada 18:00–19:00')).toBeVisible();
    const fundos = await page.evaluate(() => {
      const f = (t: string) => {
        const e = [...document.querySelectorAll('span')].find((s) => s.textContent?.startsWith(t))!.parentElement!;
        return getComputedStyle(e).backgroundImage;
      };
      return [f('Fora do funcionamento'), f('Fora da jornada')];
    });
    expect(fundos[0]).not.toBe(fundos[1]);
  });

  test('domingo: salão fechado o dia inteiro, com aviso e faixa', async ({ page }) => {
    await abrir(page, '?data=2027-03-07&profissional=demo-ana');
    await expect(page.getByText('Salão fechado neste dia.')).toBeVisible();
    await expect(page.getByText('Fora do funcionamento 00:00–24:00')).toBeVisible();
  });
});

test.describe('CA-12: status por texto', () => {
  test('cada reserva do dia mostra o rótulo do status (cancelada, concluída, não compareceu, confirmada)', async ({ page }) => {
    await abrir(page);
    for (const [id, rotulo] of [
      ['demo-r1', 'Confirmada'],
      ['demo-r2', 'Concluída'],
      ['demo-r4', 'Cancelada'],
      ['demo-r5', 'Não compareceu'],
    ] as const) {
      await expect(page.locator(`a[href$="reserva=${id}"]`).first()).toContainText(rotulo);
    }
    await expect(page.locator('a[href$="reserva=demo-r5"]').first()).toContainText('cliente removida');
  });
});

test.describe('CA-4: teclado', () => {
  test('Tab chega a "Próximo dia" e Enter navega; depois chega à reserva e Enter abre o detalhe e o link de volta', async ({ page }) => {
    await abrir(page);
    await tabAte(page, (f) => f.tag === 'A' && f.texto === 'Próximo dia');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/data=\d{4}-\d{2}-\d{2}&visao=dia$/);
    await abrir(page);
    await tabAte(page, (f) => f.tag === 'A' && f.texto === 'Hoje');
    await tabAte(page, (f) => f.tag === 'A' && f.texto === 'Semana');
    await tabAte(page, (f) => f.tag === 'SELECT');
    await tabAte(page, (f) => f.tag === 'BUTTON' && f.texto === 'Filtrar');
    const f = await tabAte(page, (x) => x.tag === 'A' && /Maria Souza/.test(x.texto));
    expect(f.texto).toContain('Confirmada');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/reserva=demo-r1$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Reserva' })).toBeVisible();
    await expect(page.getByText('(11) 98765-4321')).toBeVisible();
    await tabAte(page, (x) => x.tag === 'A' && x.texto === 'Voltar para a agenda');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 1, name: 'Agenda' })).toBeVisible();
  });

  test('o filtro por profissional funciona pelo teclado (select + Enter)', async ({ page }) => {
    await abrir(page);
    await tabAte(page, (f) => f.tag === 'SELECT');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/profissional=demo-ana/);
    await expect(page.getByRole('heading', { level: 3, name: 'Bia Demonstração' })).toHaveCount(0);
  });
});
