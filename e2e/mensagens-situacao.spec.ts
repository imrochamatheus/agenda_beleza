import { expect, test, type Page } from '@playwright/test';

import { analisarComAxe, semRolagemHorizontal } from './suporte/vitrine';

// D-043 (E7.3): situação das mensagens no detalhe e marca de falha na grade, em /dev/agenda e
// /dev/mensagens-reserva (mesmos componentes das páginas reais, sem banco), 375×812, locale en-US:
// axe 4.14.0 sem violações, sem rolagem horizontal, teclado inalterado e a geometria do bloco intacta. D-050: os
// blocos são por item (`data-item`); a falha vigente aparece em TODOS os blocos da reserva de 3 itens (demo-r9).

test.use({ locale: 'en-US' });

const TERCA = '2027-03-02';

async function abrir(page: Page, caminho: string) {
  const resposta = await page.goto(caminho);
  if (resposta?.status() !== 200) {
    throw new Error(`${caminho} respondeu ${resposta?.status()}: ligue VITRINE_COMPONENTES=true ou libere a porta do E2E (E2E_PORT, padrão 3000).`);
  }
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

test.describe('375×812 sem rolagem horizontal e sem violações do axe', () => {
  for (const caminho of [
    '/dev/agenda',
    `/dev/agenda?data=${TERCA}`,
    '/dev/agenda?visao=semana',
    '/dev/agenda?reserva=demo-r1',
    '/dev/agenda?reserva=demo-r2',
    '/dev/mensagens-reserva',
    '/dev/mensagens-reserva?vista=vazia',
  ]) {
    test(caminho, async ({ page }) => {
      await abrir(page, caminho);
      await semRolagemHorizontal(page, caminho);
      await analisarComAxe(page, caminho);
    });
  }
});

test.describe('detalhe: seção de mensagens (CA-1, CA-2, CA-4, CA-6, CA-13, CA-14)', () => {
  test('falha com data no fuso do salão e tentativas; sem falha, "enviada"; h2 após Serviços', async ({ page }) => {
    await abrir(page, '/dev/agenda?reserva=demo-r1');
    const titulos = await page.getByRole('heading', { level: 2 }).allTextContents();
    expect(titulos).toEqual(['Serviços', 'Mensagens de WhatsApp']);
    const falha = page.locator('li[data-estado="falhou"]');
    await expect(falha).toContainText('Falha ao enviar confirmação por WhatsApp');
    await expect(falha).toContainText('3 tentativas');
    await expect(falha).toContainText('Não foi possível confirmar se a mensagem foi entregue.');
    await expect(falha).toContainText(/Última tentativa: \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/);
    await abrir(page, '/dev/agenda?reserva=demo-r2');
    await expect(page.getByText('Confirmação enviada')).toBeVisible();
    await expect(page.locator('li[data-estado="falhou"]')).toHaveCount(0);
  });

  test('vitrine tipo × estado: rótulos com concordância e motivos', async ({ page }) => {
    await abrir(page, '/dev/mensagens-reserva');
    await expect(page.locator('li[data-estado]')).toHaveCount(28);
    for (const t of [
      'Confirmação enviada',
      'Cancelamento enviado',
      'Remarcação 1 sendo enviada',
      'Cancelamento sendo enviado',
      'Convite de avaliação não enviado',
      'Convite de avaliação substituído por alteração posterior',
      'Falha ao enviar convite de avaliação por WhatsApp',
      'Link de avaliação indisponível.',
      'A cliente não autorizou receber mensagens.',
    ]) {
      await expect(page.getByText(t, { exact: true }).first()).toBeVisible();
    }
    await expect(page.getByText('Última tentativa: 22/11/2026 23:35').first()).toBeVisible();
    await abrir(page, '/dev/mensagens-reserva?vista=vazia');
    await expect(page.getByText('Nenhuma mensagem de WhatsApp para esta reserva.')).toBeVisible();
  });

  test('só a falha tem fundo de erro e ícone; o texto, não a cor, diz o estado', async ({ page }) => {
    await abrir(page, '/dev/mensagens-reserva');
    const dados = await page.evaluate(() => {
      const cor = (e: Element) => getComputedStyle(e).backgroundColor;
      const raiz = getComputedStyle(document.documentElement).getPropertyValue('--cor-erro-fundo').trim();
      const sonda = document.createElement('i');
      sonda.style.backgroundColor = raiz;
      document.body.append(sonda);
      const esperada = cor(sonda);
      sonda.remove();
      const itens = [...document.querySelectorAll('li[data-estado]')];
      return {
        falhas: itens.filter((i) => cor(i) === esperada).map((i) => i.getAttribute('data-estado')),
        icones: itens.filter((i) => i.querySelector('svg')).map((i) => i.getAttribute('data-estado')),
        ocultos: [...document.querySelectorAll('li[data-estado] svg')].every((s) => s.getAttribute('aria-hidden') === 'true'),
      };
    });
    expect(new Set(dados.falhas)).toEqual(new Set(['falhou']));
    expect(new Set(dados.icones)).toEqual(new Set(['falhou']));
    expect(dados.ocultos).toBe(true);
  });
});

test.describe('grade: marca de falha (CA-8, CA-14)', () => {
  test('dia: o nome do link traz o texto antes do horário e a lista de paradas de Tab não ganha itens', async ({ page }) => {
    await abrir(page, '/dev/agenda');
    const comFalha = page.getByRole('link', { name: /Falha ao enviar mensagem/ });
    // demo-r1, demo-r4 e os 3 itens da demo-r9.
    await expect(comFalha).toHaveCount(5);
    expect((await comFalha.first().textContent())!.startsWith('Falha ao enviar mensagem.')).toBe(true);
    const marca = await page.evaluate(() => {
      const el = document.querySelector('a[data-item="demo-r1-i1"]')!;
      const t = el.querySelector('svg')!.getBoundingClientRect();
      const a = el.getBoundingClientRect();
      return {
        largura: t.width,
        altura: t.height,
        encostaNoCanto: a.right - t.right <= 4 && t.top - a.top <= 4,
        paradas: el.querySelectorAll('a, button, input, select, textarea, [tabindex]').length,
      };
    });
    expect(marca.largura).toBeGreaterThanOrEqual(18);
    expect(marca.altura).toBeGreaterThanOrEqual(18);
    expect(marca.encostaNoCanto).toBe(true);
    expect(marca.paradas).toBe(0);
    // Tab: cada link da grade é uma parada só (com ou sem marca).
    const total = await page.evaluate(() => document.querySelectorAll('a[href*="reserva="]').length);
    const vistos = new Set<string>();
    for (let i = 0; i < 100; i += 1) {
      await page.keyboard.press('Tab');
      const href = await page.evaluate(() => (document.activeElement as HTMLAnchorElement | null)?.getAttribute('href') ?? '');
      if (href.includes('reserva=')) vistos.add(href);
    }
    expect(vistos.size).toBe(total);
    expect(vistos.has('/dev/agenda?reserva=demo-r1#item-demo-r1-i1')).toBe(true);
    expect(vistos.has('/dev/agenda?reserva=demo-r9#item-demo-r9-i3')).toBe(true);
  });

  test('o bloco com falha tem a mesma posição e o mesmo tamanho que sem a marca (R-4)', async ({ page }) => {
    await abrir(page, '/dev/agenda');
    const medidas = await page.evaluate(() => {
      const ids = ['demo-r1-i1', 'demo-r4-i1', 'demo-r9-i1', 'demo-r9-i2', 'demo-r9-i3'];
      const ret = (e: Element) => {
        const r = e.getBoundingClientRect();
        return [r.x, r.y, r.width, r.height].map((n) => Math.round(n * 100) / 100);
      };
      const antes = ids.map((id) => ret(document.querySelector(`a[data-item="${id}"]`)!));
      for (const id of ids) {
        const el = document.querySelector(`a[data-item="${id}"]`)!;
        for (const c of [...el.classList]) if (c.includes('comFalha')) el.classList.remove(c);
        el.querySelector('span')?.remove();
      }
      const depois = ids.map((id) => ret(document.querySelector(`a[data-item="${id}"]`)!));
      return { antes, depois };
    });
    expect(medidas.antes).toEqual(medidas.depois);
  });

  test('bloco cancelado com falha: a marca não é riscada e fica visível', async ({ page }) => {
    await abrir(page, '/dev/agenda');
    const r = await page.evaluate(() => {
      const el = document.querySelector('a[data-item="demo-r4-i1"]')!;
      const marca = el.querySelector('svg')!.parentElement!;
      const s = getComputedStyle(marca);
      return { posicao: s.position, linha: s.textDecorationLine, visivel: marca.getBoundingClientRect().width > 0 };
    });
    expect(r).toEqual({ posicao: 'absolute', linha: 'none', visivel: true });
  });

  test('semana: texto visível "Falha ao enviar mensagem" no item', async ({ page }) => {
    await abrir(page, '/dev/agenda?visao=semana');
    const visiveis = page.getByText('Falha ao enviar mensagem', { exact: true });
    expect(await visiveis.count()).toBeGreaterThanOrEqual(2);
    await expect(visiveis.first()).toBeVisible();
    await semRolagemHorizontal(page, 'semana com falha');
  });
});
