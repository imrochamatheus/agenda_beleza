import { expect, test, type Locator, type Page } from '@playwright/test';

import { linkDoDia, reguaDaSemana, tabAte } from './suporte/publico';
import { analisarComAxe, semRolagemHorizontal } from './suporte/vitrine';

// D-051 (régua da semana no passo do 1º serviço) em /dev/reserva, sem banco: critérios visuais 1–19 do
// web-design §9 e os CA-3, CA-4, CA-12, CA-13 (b, c, d) e CA-17. Exemplo: Escova (Ana, Bia), Hidratação e
// Manicure; domingo fechado; janela de 60 dias.

const ESCOVA = '11111111-1111-4111-8111-111111111111';
const HIDRATACAO = '22222222-2222-4222-8222-222222222222';
const MANICURE = '33333333-3333-4333-8333-333333333333';
const S = `s=${ESCOVA}&s=${HIDRATACAO}&s=${MANICURE}`;

async function abrir(page: Page, busca: string) {
  const resposta = await page.goto(`/dev/reserva?${busca}`);
  if (resposta?.status() !== 200) {
    throw new Error(`/dev/reserva respondeu ${resposta?.status()}: ligue VITRINE_COMPONENTES=true ou libere a porta do E2E (E2E_PORT, padrão 3000).`);
  }
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

async function verificar(page: Page, contexto: string) {
  await semRolagemHorizontal(page, contexto);
  await analisarComAxe(page, contexto);
}

/** Invólucro com rolagem da régua (pai do `<ol>`). */
const rolagem = (page: Page): Locator => reguaDaSemana(page).locator('xpath=..');
/** As caixas dos dias (o `<a>` ou o `<span>` de cada `<li>`). */
const dias = (page: Page): Locator => reguaDaSemana(page).locator(':scope > li > :first-child');

/** Cor computada de um token (`var(--x)`) para comparar com estilos computados. */
async function corDoToken(page: Page, token: string): Promise<string> {
  return page.evaluate((t) => {
    const el = document.createElement('span');
    el.style.color = `var(${t})`;
    document.body.append(el);
    const cor = getComputedStyle(el).color;
    el.remove();
    return cor;
  }, token);
}

/** Href do primeiro dia com horário da semana atual da régua. */
async function primeiroDiaComHorario(page: Page): Promise<string> {
  const href = await reguaDaSemana(page).getByRole('link').first().getAttribute('href');
  return new URL(href!, 'http://l').searchParams.get('data')!;
}

/** Início da próxima semana (o `de` do link "Próxima semana"). */
async function inicioDaProxima(page: Page): Promise<string> {
  const href = await page.getByRole('navigation', { name: 'Semanas' }).getByRole('link', { name: 'Próxima semana' }).getAttribute('href');
  return new URL(href!, 'http://l').searchParams.get('de')!;
}

test.describe('passo 0 sem dia (CA-1, CA-3, CA-4; critérios 1–3, 5, 6, 8, 11, 12, 19)', () => {
  test('régua da semana 0 em 375×812: 7 dias, sem rolagem, alvos de 44 px, "Hoje", estado "escolha um dia"', async ({ page }) => {
    await abrir(page, S);
    const h2 = page.getByRole('heading', { level: 2, name: 'Escova' });
    await expect(h2).toHaveAccessibleDescription('Serviço 1 de 3');
    await expect(page.getByRole('heading', { level: 2, name: 'Escolha o dia' })).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 3, name: 'Escolha o dia' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Serviços escolhidos' })).toContainText('Escova · Hidratação · Manicure');
    await expect(dias(page)).toHaveCount(7);
    // Critério 5: três linhas; "Hoje" no primeiro dia da semana 0 (o rótulo acessível termina em ", hoje…").
    const primeiro = dias(page).first();
    await expect(primeiro.locator('[aria-hidden="true"]')).toHaveCount(3);
    await expect(primeiro.locator('[aria-hidden="true"]').first()).toHaveText('Hoje');
    expect(await primeiro.locator('.visualmente-oculto').innerText()).toMatch(/^\S+(-feira)?, \d{2}\/\d{2}\/\d{4}, hoje/);
    // Critério 6: nome acessível começa pelo rótulo completo; sem horário = <span> com "sem horários", fora do Tab.
    for (const link of await reguaDaSemana(page).getByRole('link').all()) {
      await expect(link).toHaveAccessibleName(/^[A-Z][a-zçá]+(-feira)?, \d{2}\/\d{2}\/\d{4}(, hoje)?$/);
    }
    const semHorario = reguaDaSemana(page).locator(':scope > li > span');
    for (const s of await semHorario.all()) {
      await expect(s.locator('.visualmente-oculto')).toContainText('sem horários');
      expect(await s.getAttribute('tabindex')).toBeNull();
    }
    // Critério 8: número riscado e fundo alternativo no dia sem horário (domingo existe em toda semana cheia).
    const alt = await corDoToken(page, '--cor-superficie-alt');
    const domingo = semHorario.first();
    expect(await domingo.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe(alt);
    expect(await domingo.locator('[aria-hidden="true"]').nth(1).evaluate((e) => getComputedStyle(e).textDecorationLine)).toBe('line-through');

    // Critérios 1–3: sem rolagem do documento nem da régua; cada dia ≥ 44 × 44 e dentro do cartão.
    await semRolagemHorizontal(page, 'passo 0 sem dia');
    const r = await rolagem(page).evaluate((e) => ({ scroll: e.scrollWidth, cliente: e.clientWidth }));
    expect(r.scroll).toBe(r.cliente);
    const cartao = await page.locator('section:has(> h2#reservar)').boundingBox();
    for (const d of await dias(page).all()) {
      const caixa = (await d.boundingBox())!;
      expect(caixa.width).toBeGreaterThanOrEqual(44);
      expect(caixa.height).toBeGreaterThanOrEqual(44);
      expect(caixa.x).toBeGreaterThanOrEqual(cartao!.x);
      expect(caixa.x + caixa.width).toBeLessThanOrEqual(cartao!.x + cartao!.width + 0.5);
    }
    // Número em --fonte-titulo, igual ao h2.
    const familia = await h2.evaluate((e) => getComputedStyle(e).fontFamily);
    expect(await primeiro.locator('[aria-hidden="true"]').nth(1).evaluate((e) => getComputedStyle(e).fontFamily)).toBe(familia);

    // CA-4 / critério 12: estado vazio, sem roteiro, filtro, grade, botão nem aria-current.
    await expect(page.getByRole('heading', { level: 3, name: 'Escolha um dia para ver os horários' })).toBeVisible();
    await expect(page.getByText('Os horários de Escova aparecem aqui, separados por profissional.')).toBeVisible();
    await expect(page.getByRole('list', { name: 'Seu dia' })).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Filtrar por profissional' })).toHaveCount(0);
    await expect(page.getByRole('radio')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Continuar/ })).toHaveCount(0);
    await expect(page.locator('[aria-current="date"]')).toHaveCount(0);
    // CA-3 / critério 11: semana 0 sem "Semana anterior" (nem texto).
    await expect(page.getByText('Semana anterior')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Próxima semana' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Escolher outro dia' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Alterar serviços' })).toBeVisible();
    await analisarComAxe(page, 'passo 0 sem dia');
  });

  test('CA-3: última semana (de além da janela) com 5 dias e sem "Próxima semana"; semana intermediária com as duas', async ({ page }) => {
    await abrir(page, `${S}&de=2099-01-01`);
    await expect(dias(page)).toHaveCount(5);
    await expect(page.getByText('Próxima semana')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Semana anterior' })).toBeVisible();
    await verificar(page, 'última semana');
    await abrir(page, S);
    const proxima = await inicioDaProxima(page);
    await page.getByRole('link', { name: 'Próxima semana' }).click();
    await expect(page).toHaveURL(new RegExp(`de=${proxima}#reservar$`));
    await expect(page).not.toHaveURL(/data=|h\d=/);
    await expect(dias(page)).toHaveCount(7);
    await expect(page.getByRole('link', { name: 'Semana anterior' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Próxima semana' })).toBeVisible();
  });
});

test.describe('passo 0 com dia (CA-5, CA-7; critérios 7, 9, 10, 13, 14, 18)', () => {
  test('dia marcado, horários abaixo, foco interno e ordem de Tab; links terminam em #reservar', async ({ page }) => {
    await abrir(page, S);
    await page.getByRole('link', { name: 'Próxima semana' }).click();
    await expect(page).toHaveURL(/de=.*#reservar$/);
    const data = await primeiroDiaComHorario(page);
    // Critério 14: todo href de dia e de semana termina em #reservar; ao abrir, o h2 fica visível sem rolar.
    for (const a of await page.locator('ol[aria-labelledby] a, nav[aria-label="Semanas"] a').all()) {
      expect(await a.getAttribute('href')).toMatch(/#reservar$/);
    }
    await linkDoDia(page, data).click();
    await expect(page).toHaveURL(new RegExp(`data=${data}#reservar$`));
    await expect(page.getByRole('heading', { level: 2, name: 'Escova' })).toBeInViewport();
    const marcado = linkDoDia(page, data);
    await expect(marcado).toHaveAttribute('aria-current', 'date');
    // Critério 7: fundo --cor-primaria-forte, texto --cor-sobre-primaria e barra interna de 3 px.
    const estilo = await marcado.evaluate((e) => ({ fundo: getComputedStyle(e).backgroundColor, cor: getComputedStyle(e).color, sombra: getComputedStyle(e).boxShadow }));
    expect(estilo.fundo).toBe(await corDoToken(page, '--cor-primaria-forte'));
    expect(estilo.cor).toBe(await corDoToken(page, '--cor-sobre-primaria'));
    expect(estilo.sombra).toMatch(/inset/);
    expect(estilo.sombra).toMatch(/-3px/);
    // A grade do serviço 0 (D-050) abaixo da régua; o passo 0 não tem "Escolher outro dia" (critério 18).
    await expect(page.getByRole('list', { name: 'Seu dia' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Filtrar por profissional' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Escolher outro dia' })).toHaveCount(0);
    // Critério 13: no DOM, a régua vem antes do roteiro e da grade.
    const ordem = await page.evaluate(() => {
      const regua = document.querySelector('ol[aria-labelledby]')!;
      const roteiro = document.querySelector('ol[aria-label="Seu dia"]')!;
      const radio = document.querySelector('input[type=radio]')!;
      return [regua.compareDocumentPosition(roteiro) & 4, roteiro.compareDocumentPosition(radio) & 4];
    });
    expect(ordem).toEqual([4, 4]);
    await verificar(page, 'passo 0 com dia');

    // Critérios 9 e 10: ordem de Tab a partir do topo; foco visível em cada parada (tabAte confere).
    await abrir(page, `${S}&data=${data}`);
    const paradas: string[] = [];
    for (let i = 0; i < 250; i += 1) {
      await page.keyboard.press('Tab');
      const d = await page.evaluate(() => {
        const e = document.activeElement as HTMLElement;
        const s = getComputedStyle(e);
        return {
          tipo: e.closest('ol[aria-labelledby]') ? 'dia' : e.closest('nav[aria-label="Semanas"]') ? 'semana' : e.closest('nav[aria-label="Filtrar por profissional"]') ? 'filtro' : (e as HTMLInputElement).type === 'radio' ? 'grade' : e.tagName === 'BUTTON' && (e.textContent ?? '').trim() === 'Continuar' ? 'continuar' : (e.textContent ?? '').trim(),
          contorno: s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0,
          cor: s.outlineColor,
          atual: e.getAttribute('aria-current'),
        };
      });
      paradas.push(d.tipo);
      if (d.tipo === 'dia') {
        expect(d.contorno).toBe(true);
        // Selecionado com foco: contorno em --cor-sobre-primaria; os outros em --cor-foco.
        expect(d.cor).toBe(await corDoToken(page, d.atual === 'date' ? '--cor-sobre-primaria' : '--cor-foco'));
      }
      if (d.tipo === 'Alterar serviços') break;
    }
    const primeiro = (t: string) => paradas.indexOf(t);
    const ultimo = (t: string) => paradas.lastIndexOf(t);
    expect(primeiro('dia')).toBeGreaterThanOrEqual(0);
    expect(ultimo('dia')).toBeLessThan(primeiro('semana'));
    expect(ultimo('semana')).toBeLessThan(primeiro('filtro'));
    expect(ultimo('filtro')).toBeLessThan(primeiro('grade'));
    expect(ultimo('grade')).toBeLessThan(primeiro('continuar'));
    expect(primeiro('continuar')).toBeLessThan(paradas.indexOf('Alterar serviços'));
    // Duas paradas de semana (anterior e próxima) nesta semana intermediária.
    expect(paradas.filter((t) => t === 'semana')).toHaveLength(2);
  });

  test('CA-7: a partir de "Alterar" do item 0, outro dia descarta os horários e a semana desmarca o dia', async ({ page }) => {
    await abrir(page, S);
    await page.getByRole('link', { name: 'Próxima semana' }).click();
    await expect(page).toHaveURL(/de=.*#reservar$/);
    const data = await primeiroDiaComHorario(page);
    // Itens das 3 linhas via o exemplo de dados: escolher pela grade e seguir até os dados.
    await linkDoDia(page, data).click();
    await page.getByRole('group', { name: 'Horários de Ana' }).getByRole('radio', { name: '09:00', exact: true }).check();
    await page.getByRole('button', { name: 'Continuar' }).click();
    await page.getByRole('group', { name: 'Horários de Carla' }).getByRole('radio', { name: '10:00', exact: true }).check();
    await page.getByRole('button', { name: 'Continuar' }).click();
    await page.getByRole('group', { name: 'Horários de Carla' }).getByRole('radio', { name: '15:00', exact: true }).check();
    await page.getByRole('button', { name: 'Continuar para seus dados' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Seus dados' })).toBeVisible();
    await page.getByRole('link', { name: /^Alterar Escova/ }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Escova' })).toBeVisible();
    await expect(linkDoDia(page, data)).toHaveAttribute('aria-current', 'date');
    await expect(page.getByRole('radio', { checked: true })).toHaveCount(1);
    // Outro dia da mesma semana: sem h*, alterar, f, enviado, aviso; nada pré-selecionado.
    const outro = reguaDaSemana(page).locator('a:not([aria-current])').first();
    const destino = (await outro.getAttribute('href'))!;
    expect(destino).not.toMatch(/h\d=|alterar|[?&]f=|enviado|aviso/);
    await outro.click();
    await expect(page.locator('[aria-current="date"]')).toHaveCount(1);
    await expect(page.getByRole('radio', { checked: true })).toHaveCount(0);
    const paradas = page.getByRole('list', { name: 'Seu dia' }).locator(':scope > li');
    await expect(paradas.and(page.locator('[data-estado="escolhida"]'))).toHaveCount(0);
    await expect(paradas.and(page.locator('[data-estado="pendente"]'))).toHaveCount(2);
    // Semana: sem data nem h*, volta ao estado sem dia (CA-4).
    await page.getByRole('link', { name: 'Próxima semana' }).click();
    await expect(page).not.toHaveURL(/data=|h\d=/);
    await expect(page.getByRole('heading', { level: 3, name: 'Escolha um dia para ver os horários' })).toBeVisible();
  });

  test('critério 18: passo k ≥ 1 sem régua, com "Escolher outro dia" que leva à semana da data (CA-10)', async ({ page }) => {
    await abrir(page, S);
    const data = await primeiroDiaComHorario(page);
    await linkDoDia(page, data).click();
    const radio = page.getByRole('radio').first();
    await radio.check();
    await page.getByRole('button', { name: 'Continuar' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Hidratação' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 3, name: 'Escolha o dia' })).toHaveCount(0);
    await page.getByRole('link', { name: 'Escolher outro dia' }).click();
    await expect(page).not.toHaveURL(/h\d=|data=/);
    await expect(page.getByRole('heading', { level: 2, name: 'Escova' })).toBeVisible();
    await expect(linkDoDia(page, data)).toBeVisible();
    await expect(page.locator('[aria-current="date"]')).toHaveCount(0);
  });

  test('critério 13 e CA-11: "Continuar" sem horário → aviso antes da régua, dia mantido', async ({ page }) => {
    await abrir(page, S);
    const data = await primeiroDiaComHorario(page);
    await linkDoDia(page, data).click();
    await page.getByRole('button', { name: 'Continuar' }).click();
    const aviso = page.getByRole('status').filter({ hasText: 'Escolha um horário para Escova.' });
    await expect(aviso).toBeVisible();
    await expect(linkDoDia(page, data)).toHaveAttribute('aria-current', 'date');
    const antes = await aviso.evaluate((a) => (a.compareDocumentPosition(document.querySelector('ol[aria-labelledby]')!) & 4) === 4);
    expect(antes).toBe(true);
  });
});

test.describe('semana sem nenhum dia oferecido (CA-12, CA-17; critério 16)', () => {
  test('?vista=semana-vazia: todos os dias desabilitados, estado vazio, "Próxima semana" e axe', async ({ page }) => {
    await abrir(page, `${S}&vista=semana-vazia`);
    await expect(reguaDaSemana(page).getByRole('link')).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 3, name: 'Nenhum dia desta semana tem horário' })).toBeVisible();
    await expect(page.getByText('Veja a próxima semana ou altere os serviços.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Próxima semana' })).toHaveCount(1);
    // C2: o invólucro vira um grupo focável nomeado pelo título e pelo período.
    await expect(page.getByRole('group', { name: /^Escolha o dia \d{2}\/\d{2}\/\d{4} a \d{2}\/\d{2}\/\d{4}$/ })).toHaveAttribute('tabindex', '0');
    await verificar(page, 'semana vazia');
  });
});

test.describe('320 px (critério 4)', () => {
  test('a régua rola por dentro, o documento não; Tab até o último dia o deixa visível; semana vazia sem violação', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 812 });
    await abrir(page, S);
    await semRolagemHorizontal(page, '320 px');
    const r = await rolagem(page).evaluate((e) => ({ scroll: e.scrollWidth, cliente: e.clientWidth }));
    expect(r.scroll).toBeGreaterThan(r.cliente);
    const ultimo = reguaDaSemana(page).getByRole('link').last();
    await tabAte(page, ultimo);
    await expect(ultimo).toBeInViewport();
    await abrir(page, `${S}&vista=semana-vazia`);
    await semRolagemHorizontal(page, '320 px semana vazia');
    const grupo = page.getByRole('group', { name: /^Escolha o dia/ });
    await tabAte(page, grupo);
    await analisarComAxe(page, '320 px semana vazia');
  });
});

test.describe('768 e 1280 px (critérios 1, 3)', () => {
  for (const largura of [768, 1280]) {
    test(`${largura} px: régua ≤ 36rem, sem rolagem`, async ({ page }) => {
      await page.setViewportSize({ width: largura, height: 900 });
      await abrir(page, S);
      await semRolagemHorizontal(page, `${largura} px`);
      const caixa = (await reguaDaSemana(page).boundingBox())!;
      expect(caixa.width).toBeLessThanOrEqual(576);
      const r = await rolagem(page).evaluate((e) => ({ scroll: e.scrollWidth, cliente: e.clientWidth }));
      expect(r.scroll).toBe(r.cliente);
    });
  }
});

test.describe('sem JavaScript (critério 17)', () => {
  test.use({ javaScriptEnabled: false });

  test('semana e dia por links GET; o horário segue no formulário GET', async ({ page }) => {
    await abrir(page, S);
    await page.getByRole('link', { name: 'Próxima semana' }).click();
    await expect(page.getByRole('link', { name: 'Semana anterior' })).toBeVisible();
    await expect(page).toHaveURL(/de=/);
    const data = await primeiroDiaComHorario(page);
    await linkDoDia(page, data).click();
    await expect(linkDoDia(page, data)).toHaveAttribute('aria-current', 'date');
    await page.getByRole('radio').first().check();
    await page.getByRole('button', { name: 'Continuar' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Hidratação' })).toBeVisible();
    await expect(page).toHaveURL(/h0=/);
  });
});
