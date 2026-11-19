import { expect, test, type Page } from '@playwright/test';

import {
  abrirVitrine,
  analisarComAxe,
  marcarInterativos,
  percorrerComTab,
  semRolagemHorizontal,
  tabAte,
  VARIANTES,
} from './suporte/vitrine';

// E2E de acessibilidade da base visual (D-009 §3.11): teclado, diálogo, menu móvel, larguras,
// fontes e axe. Roda no projeto mobile-chromium (375 × 812); outras larguras por setViewportSize.
test.describe.configure({ mode: 'parallel' });

const focadoDentroDoDialogo = (page: Page) =>
  page.evaluate(() => {
    const d = document.querySelector('dialog[open]');
    return !!d && d.contains(document.activeElement);
  });

const textoFocado = (page: Page) => page.evaluate(() => (document.activeElement?.textContent ?? '').trim());

test('CA-18: a vitrine responde 200 com noindex quando a variável está ligada', async ({ page }) => {
  const resposta = await abrirVitrine(page);
  expect(resposta.status()).toBe(200);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
  await expect(page).toHaveTitle('Vitrine de componentes · Agenda Beleza');
});

test('CA-19: títulos com a fonte serifada e parágrafos com a sem serifa (carregadas)', async ({ page }) => {
  await abrirVitrine(page);
  const fontes = await page.evaluate(() => {
    const primeiro = (lista: string) => lista.split(',')[0].trim().replace(/^["']|["']$/g, '');
    const raiz = getComputedStyle(document.documentElement);
    const titulo = primeiro(raiz.getPropertyValue('--fonte-titulo'));
    const corpo = primeiro(raiz.getPropertyValue('--fonte-corpo'));
    return {
      titulo,
      corpo,
      h1: primeiro(getComputedStyle(document.querySelector('h1')!).fontFamily),
      p: primeiro(getComputedStyle(document.querySelector('main p')!).fontFamily),
      carregadas: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/["']/g, '')),
    };
  });
  expect(fontes.titulo).not.toBe('');
  expect(fontes.corpo).not.toBe('');
  expect(fontes.titulo).not.toBe(fontes.corpo);
  expect(fontes.h1).toBe(fontes.titulo);
  expect(fontes.p).toBe(fontes.corpo);
  expect(fontes.carregadas).toEqual(expect.arrayContaining([fontes.titulo, fontes.corpo]));
});

for (const variante of VARIANTES.filter((v) => v.menu > 0)) {
  test(`CA-3: menu móvel só pelo teclado em 375 px (${variante.nome})`, async ({ page }) => {
    await abrirVitrine(page, variante.busca);
    await semRolagemHorizontal(page, `${variante.nome} 375`);
    const botao = page.getByRole('button', { name: 'Menu' });
    const nav = page.locator(`#${await botao.getAttribute('aria-controls')}`);
    const links = nav.getByRole('link');
    await expect(botao).toHaveAttribute('aria-expanded', 'false');
    await expect(nav).toBeHidden();
    await expect(links.first()).toBeHidden();

    await tabAte(page, (e) => e.tag === 'BUTTON' && e.texto === 'Menu');
    await page.keyboard.press('Enter');
    await expect(botao).toHaveAttribute('aria-expanded', 'true');
    await expect(links).toHaveCount(variante.menu);
    for (let i = 0; i < variante.menu; i += 1) await expect(links.nth(i)).toBeVisible();
    await expect(links.first()).toBeFocused();
    if (variante.nome === 'painel-gestor') {
      await expect(links).toHaveText([
        'Agenda',
        'Clientes',
        'Serviços',
        'Profissionais',
        'Bloqueios',
        'Configurações',
        'Assinatura',
      ]);
    }
    await semRolagemHorizontal(page, `${variante.nome} menu aberto`);
    await analisarComAxe(page, `${variante.nome} com o menu aberto`);

    // Disclosure: Tab depois do último item segue adiante e o menu continua aberto.
    for (let i = 1; i < variante.menu; i += 1) await page.keyboard.press('Tab');
    await expect(links.last()).toBeFocused();
    await page.keyboard.press('Tab');
    expect(await nav.evaluate((n) => n.contains(document.activeElement))).toBe(false);
    await expect(botao).toHaveAttribute('aria-expanded', 'true');

    // Esc dentro do menu fecha e devolve o foco ao botão.
    await links.first().focus();
    await page.keyboard.press('Escape');
    await expect(botao).toHaveAttribute('aria-expanded', 'false');
    await expect(botao).toBeFocused();
    await expect(nav).toBeHidden();

    // Espaço também abre; acionar de novo fecha.
    await page.keyboard.press('Space');
    await expect(botao).toHaveAttribute('aria-expanded', 'true');
    await botao.focus();
    await page.keyboard.press('Enter');
    await expect(nav).toBeHidden();
  });
}

test.describe('CA-4: diálogo de confirmação só pelo teclado', () => {
  test('ciclo de foco, Esc, Cancelar, Confirmar e fundo inerte', async ({ page }) => {
    await abrirVitrine(page);
    const confirmados = page.getByTestId('contador-confirmado');
    const cancelados = page.getByTestId('contador-cancelado');
    const origem = page.getByRole('button', { name: 'Abrir confirmação', exact: true });
    const aberto = page.locator('dialog[open]');

    // 1. Tab até a origem e Enter: aberto, foco em Cancelar.
    await tabAte(page, (e) => e.texto === 'Abrir confirmação');
    await page.keyboard.press('Enter');
    await expect(aberto).toHaveCount(1);
    await expect(aberto.getByRole('button', { name: 'Cancelar' })).toBeFocused();
    await analisarComAxe(page, 'diálogo primário aberto');

    // 2. Duas voltas completas em cada sentido: o foco nunca sai do diálogo.
    for (const tecla of ['Tab', 'Shift+Tab']) {
      for (let i = 0; i < 4; i += 1) {
        await page.keyboard.press(tecla);
        expect(await focadoDentroDoDialogo(page), `${tecla} #${i}`).toBe(true);
      }
    }

    // 6. Com o diálogo aberto, o fundo não reage a clique (inert do modal) nem fecha pelo backdrop.
    // Um controle do fundo visível e fora do retângulo do diálogo (o clique atinge o backdrop).
    const alvo = await page.evaluate(() => {
      const r = document.querySelector('dialog[open]')!.getBoundingClientRect();
      for (const e of document.querySelectorAll<HTMLElement>('main button, main a[href], main input')) {
        if (e.closest('dialog')) continue;
        const c = e.getBoundingClientRect();
        const x = c.left + c.width / 2;
        const y = c.top + c.height / 2;
        const naTela = c.width > 0 && y > 0 && y < innerHeight && x > 0 && x < innerWidth;
        if (naTela && (x < r.left || x > r.right || y < r.top || y > r.bottom)) {
          return { x, y, texto: (e.textContent ?? '').trim() || e.getAttribute('name') };
        }
      }
      return null;
    });
    expect(alvo, 'nenhum controle do fundo visível fora do diálogo').not.toBeNull();
    const antes = await page.locator('main').evaluate((m) => (m as HTMLElement).innerText);
    await page.mouse.click(alvo!.x, alvo!.y);
    await page.mouse.click(5, 5);
    await expect(aberto).toHaveCount(1);
    await expect(aberto.getByRole('heading')).toHaveText('Confirmar a reserva?');
    await expect(page.getByTestId('contador-cancelado')).toHaveText('Cancelamentos: 0');
    expect(await page.locator('main').evaluate((m) => (m as HTMLElement).innerText)).toBe(antes);
    expect(await focadoDentroDoDialogo(page)).toBe(true);

    // 3. Esc: fecha como cancelado e devolve o foco.
    await aberto.getByRole('button', { name: 'Cancelar' }).focus();
    await page.keyboard.press('Escape');
    await expect(aberto).toHaveCount(0);
    await expect(cancelados).toHaveText('Cancelamentos: 1');
    await expect(confirmados).toHaveText('Confirmações: 0');
    await expect(origem).toBeFocused();

    // 4. Reabrir, voltar a Cancelar por Tab e Enter.
    await page.keyboard.press('Enter');
    await expect(aberto).toHaveCount(1);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    expect(await textoFocado(page)).toBe('Cancelar');
    await page.keyboard.press('Enter');
    await expect(aberto).toHaveCount(0);
    await expect(cancelados).toHaveText('Cancelamentos: 2');
    await expect(origem).toBeFocused();

    // 5. Reabrir, Tab até Confirmar e Enter: confirma uma vez.
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    expect(await textoFocado(page)).toBe('Confirmar');
    await page.keyboard.press('Enter');
    await expect(aberto).toHaveCount(0);
    await expect(confirmados).toHaveText('Confirmações: 1');
    await expect(cancelados).toHaveText('Cancelamentos: 2');
    await expect(origem).toBeFocused();
  });

  test('R-1: na confirmação demorada, Esc é ignorado e a confirmação conta uma vez', async ({ page }) => {
    await abrirVitrine(page);
    const origem = page.getByRole('button', { name: 'Abrir confirmação demorada' });
    const aberto = page.locator('dialog[open]');
    await origem.focus();
    await page.keyboard.press('Enter');
    await expect(aberto.getByRole('button', { name: 'Voltar' })).toBeFocused();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await expect(aberto.getByRole('button', { name: 'Cancelando…' })).toBeDisabled();
    for (let i = 0; i < 3; i += 1) await page.keyboard.press('Escape');
    await expect(aberto).toHaveCount(1);
    await expect(page.getByTestId('contador-cancelado')).toHaveText('Cancelamentos: 0');
    await expect(aberto).toHaveCount(0, { timeout: 5000 });
    await expect(page.getByTestId('contador-confirmado')).toHaveText('Confirmações: 1');
    await expect(origem).toBeFocused();
  });

  test('confirmação que falha: continua aberta com alerta e foco no confirmar', async ({ page }) => {
    await abrirVitrine(page);
    await page.getByRole('button', { name: 'Abrir confirmação que falha' }).focus();
    await page.keyboard.press('Enter');
    const aberto = page.locator('dialog[open]');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await expect(aberto.getByRole('alert')).toHaveText('Não foi possível concluir. Tente novamente.');
    await expect(aberto.getByRole('button', { name: 'Enviar' })).toBeFocused();
    await analisarComAxe(page, 'diálogo com erro');
    await page.keyboard.press('Escape');
    await expect(aberto).toHaveCount(0);
    await expect(page.getByTestId('contador-confirmado')).toHaveText('Confirmações: 0');
  });

  for (const nome of ['Abrir confirmação de perigo', 'Abrir confirmação demorada', 'Abrir confirmação que falha']) {
    test(`CA-15: axe com o diálogo aberto (${nome})`, async ({ page }) => {
      await abrirVitrine(page);
      await page.getByRole('button', { name: nome }).click();
      await expect(page.locator('dialog[open]')).toHaveCount(1);
      await analisarComAxe(page, nome);
    });
  }
});

for (const variante of VARIANTES) {
  test(`CA-14/CA-15: teclado, larguras e axe (${variante.nome})`, async ({ page }) => {
    await abrirVitrine(page, variante.busca);

    // Larguras sem rolagem horizontal; axe em 375 e 1280.
    for (const largura of [320, 375, 1280]) {
      await page.setViewportSize({ width: largura, height: 812 });
      await semRolagemHorizontal(page, `${variante.nome} ${largura}`);
    }
    await analisarComAxe(page, `${variante.nome} 1280`);

    // 1280: botão de menu oculto e navegação visível e focável.
    if (variante.menu > 0) {
      await expect(page.getByRole('button', { name: 'Menu' })).toBeHidden();
      const links = page.getByRole('navigation', { name: /Navegação/ }).getByRole('link');
      await expect(links).toHaveCount(variante.menu);
      for (let i = 0; i < variante.menu; i += 1) await expect(links.nth(i)).toBeVisible();
    }

    await page.setViewportSize({ width: 375, height: 812 });
    await analisarComAxe(page, `${variante.nome} 375`);

    // 1º Tab: "Pular para o conteúdo", visível; Enter leva o foco ao main.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Tab');
    const pular = page.getByRole('link', { name: 'Pular para o conteúdo' });
    await expect(pular).toBeFocused();
    await expect(pular).toBeInViewport();
    await page.keyboard.press('Enter');
    await expect(page.locator('main#conteudo')).toBeFocused();

    // Percurso por Tab: foco visível em todos e todos os interativos alcançados.
    const esperados = await marcarInterativos(page);
    const paradas = await percorrerComTab(page);
    for (const parada of paradas) {
      expect(parada.outlineStyle, `${parada.chave} sem contorno`).not.toBe('none');
      expect(parada.outlineWidth, `${parada.chave} contorno fino`).toBeGreaterThanOrEqual(2);
    }
    const alcancados = new Set(paradas.map((p) => p.chave));
    expect(esperados.filter((c) => !alcancados.has(c))).toEqual([]);
    expect(esperados.length).toBeGreaterThan(25);
  });
}

test('CA-14: item ativo com caminho simulado /painel/agenda/nova', async ({ page }) => {
  await abrirVitrine(page, 'layout=painel&papel=gestor&caminho=/painel/agenda/nova');
  await page.setViewportSize({ width: 1280, height: 812 });
  const atuais = page.locator('nav [aria-current="page"]');
  await expect(atuais).toHaveCount(1);
  await expect(atuais).toHaveText('Agenda');
});

test('CA-14: alvos de pelo menos 44 × 44 px em 375 px', async ({ page }) => {
  await abrirVitrine(page, 'layout=painel&papel=gestor');
  const pequenos = async (seletor: string) =>
    page.locator(seletor).evaluateAll((els) =>
      els
        .filter((e) => (e as HTMLElement).offsetParent !== null)
        .map((e) => ({ r: e.getBoundingClientRect(), t: (e.textContent ?? '').trim() || e.getAttribute('value') }))
        .filter(({ r }) => r.width < 44 || r.height < 44)
        .map(({ r, t }) => `${t} ${Math.round(r.width)}×${Math.round(r.height)}`),
    );
  expect(await page.locator('main button').count()).toBeGreaterThan(10);
  expect(await pequenos('main button')).toEqual([]);
  expect(await pequenos('main input[type="radio"]')).toEqual([]);
  expect(await page.locator('main input[type="radio"]').count()).toBe(8);
  const menu = page.getByRole('button', { name: 'Menu' });
  expect(await pequenos('header + div button[aria-controls]')).toEqual([]);
  await menu.click();
  expect(await pequenos('nav[data-aberto="true"] a')).toEqual([]);
  expect(await page.locator('nav[data-aberto="true"] a').count()).toBe(7);
});

test('RN-6: texto a 200% em 1280 px sem rolagem horizontal', async ({ page }) => {
  await abrirVitrine(page, 'layout=painel&papel=gestor');
  await page.setViewportSize({ width: 1280, height: 812 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  await semRolagemHorizontal(page, 'texto a 200%');
});

test('RN-7: movimento reduzido desliga as transições', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await abrirVitrine(page);
  const duracao = await page
    .getByRole('button', { name: 'Salvar', exact: true })
    .evaluate((e) => getComputedStyle(e).transitionDuration);
  expect(duracao.split(',').every((d) => parseFloat(d) === 0)).toBe(true);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const normal = await page
    .getByRole('button', { name: 'Salvar', exact: true })
    .evaluate((e) => getComputedStyle(e).transitionDuration);
  expect(normal.split(',').some((d) => parseFloat(d) > 0)).toBe(true);
});

test.describe('CA-16: componentes no navegador (375 px)', () => {
  test('SlotGrid: Tab entra no grupo, setas mudam a seleção, Tab sai; grade vazia', async ({ page }) => {
    await abrirVitrine(page);
    const grupo = page.getByRole('group', { name: 'Horários de terça-feira, 10/03/2026' });
    const radios = grupo.getByRole('radio');
    // O interativo anterior à grade (na ordem do DOM) é o "Tentar novamente".
    await page.getByRole('button', { name: 'Tentar novamente' }).focus();
    await page.keyboard.press('Tab');
    await expect(radios.nth(0)).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(radios.nth(1)).toBeFocused();
    await expect(radios.nth(1)).toBeChecked();
    await page.keyboard.press('ArrowRight');
    await expect(radios.nth(2)).toBeChecked();
    await expect(radios.nth(1)).not.toBeChecked();
    await expect(page.getByTestId('horario-escolhido')).toHaveText('Horário escolhido: 10/03/2026 10:00');
    await page.keyboard.press('ArrowLeft');
    await expect(radios.nth(1)).toBeChecked();
    await page.keyboard.press('Tab');
    expect(await grupo.evaluate((g) => g.contains(document.activeElement))).toBe(false);
    await expect(page.getByRole('radio', { name: '23:00 (UTC−02:00)' })).toBeFocused();
    await expect(page.getByRole('heading', { name: 'Nenhum horário disponível nesta data.' })).toBeVisible();
  });

  test('Field com erro: aria-invalid e aria-describedby para o erro visível', async ({ page }) => {
    await abrirVitrine(page);
    const campo = page.getByLabel('E-mail de contato');
    await expect(campo).toHaveAttribute('aria-invalid', 'true');
    const id = await campo.getAttribute('aria-describedby');
    const erro = page.locator(`#${id}`);
    await expect(erro).toBeVisible();
    await expect(erro).toHaveText('Erro: Informe um e-mail válido.');
    await expect(campo).toHaveAccessibleDescription('Erro: Informe um e-mail válido.');
  });

  test('Checkbox alterna com Espaço e com clique no rótulo', async ({ page }) => {
    await abrirVitrine(page);
    const caixa = page.getByRole('checkbox', { name: 'Lembrar este dispositivo' });
    await caixa.focus();
    await page.keyboard.press('Space');
    await expect(caixa).toBeChecked();
    await page.keyboard.press('Space');
    await expect(caixa).not.toBeChecked();
    await page.getByText('Lembrar este dispositivo').click();
    await expect(caixa).toBeChecked();
  });

  test('DataList: empilhado com rótulos em 375 px; tabela com cabeçalhos em 1280 px', async ({ page }) => {
    await abrirVitrine(page);
    const tabela = page.getByRole('table', { name: 'Serviços do salão' });
    await semRolagemHorizontal(page, 'DataList 375');
    const celulas = tabela.locator('td');
    const total = await celulas.count();
    expect(total).toBe(12);
    for (let i = 0; i < total; i += 1) {
      await expect(celulas.nth(i).locator('span[aria-hidden="true"]')).toBeVisible();
    }
    await expect(tabela.getByRole('columnheader')).toHaveCount(4);
    // Cabeçalho só visualmente oculto (1 × 1 px), mas presente na árvore de acessibilidade.
    expect((await tabela.locator('thead').boundingBox())!.width).toBeLessThanOrEqual(1);

    await page.setViewportSize({ width: 1280, height: 812 });
    expect(await tabela.evaluate((t) => getComputedStyle(t).display)).toBe('table');
    await expect(tabela.getByRole('columnheader')).toHaveText(['Serviço', 'Duração', 'Preço', 'Contato']);
    for (let i = 0; i < 4; i += 1) await expect(tabela.getByRole('columnheader').nth(i)).toBeVisible();
    await expect(celulas.first().locator('span[aria-hidden="true"]')).toBeHidden();
    await semRolagemHorizontal(page, 'DataList 1280');
  });
});
