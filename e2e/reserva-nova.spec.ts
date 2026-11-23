import { expect, test, type Locator, type Page } from '@playwright/test';

import { comBanco, contarReservas, telefoneUnico } from './suporte/fixtures';
import { diaFuturo } from './suporte/publico';
import { analisarComAxe, semRolagemHorizontal } from './suporte/vitrine';

// D-029 CA-15/CA-16 e D-050 CA-23, CA-36 e critérios visuais 3–6, 24 e 25: reserva manual da equipe com N
// linhas (serviço, profissional e hora por linha; data única), só com o teclado, foco no aviso de encaixe e no
// resultado, axe sem violações e 375×812 sem rolagem horizontal. Em /dev/reserva-nova (mesmos componentes da
// página real, ação que só valida, sem banco): jornada seg–sáb 09:00–18:00, funcionamento seg–sex 08:00–20:00,
// bloqueio 13:00–14:00 só da Carla. O CA-23 roda com banco em /painel/agenda/nova (/e2e-reservas-8).

/** Próxima terça-feira (AAAA-MM-DD) de 7 a 13 dias à frente, no fuso do salão. */
const proximaTerca = (): string => diaFuturo({ de: 7, ate: 13, semana: [2] });

async function abrir(page: Page, busca = '') {
  const resposta = await page.goto(`/dev/reserva-nova${busca}`);
  if (resposta?.status() !== 200) {
    throw new Error(`/dev/reserva-nova respondeu ${resposta?.status()}: ligue VITRINE_COMPONENTES=true ou libere a porta do E2E (E2E_PORT, padrão 3000).`);
  }
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

async function verificar(page: Page, contexto: string) {
  await semRolagemHorizontal(page, contexto);
  await analisarComAxe(page, contexto);
}

/**
 * Tab até o alvo; confere o foco visível em cada parada. O seletor de data nativo tem várias paradas internas
 * (dia, mês, ano e o botão do calendário) com o mesmo `activeElement`.
 */
async function tabAte(page: Page, alvo: Locator, limite = 60) {
  for (let i = 0; i < limite; i += 1) {
    await page.keyboard.press('Tab');
    const f = await page.evaluate(() => {
      const e = document.activeElement as HTMLElement;
      const s = getComputedStyle(e);
      return { tag: e.tagName, id: e.id, data: (e as HTMLInputElement).type === 'date', estilo: s.outlineStyle, contorno: parseFloat(s.outlineWidth) };
    });
    if (f.tag !== 'BODY' && !f.data) {
      expect(f.estilo, `foco visível em ${f.tag}#${f.id}`).not.toBe('none');
      expect(f.contorno, `contorno em ${f.tag}#${f.id}`).toBeGreaterThan(0);
    }
    if (await alvo.evaluate((e) => e === document.activeElement)) return;
  }
  throw new Error('alvo não alcançado por Tab');
}

const linha = (page: Page, n: number) => page.getByRole('group', { name: `Serviço ${n}`, exact: true });

/** Preenche uma linha só com o teclado: Tab até cada campo, digitação (o select escolhe pela primeira letra). */
async function preencherLinha(page: Page, n: number, v: { servico: string; profissional: string; hora: string }) {
  const l = linha(page, n);
  await tabAte(page, l.getByRole('combobox', { name: 'Serviço' }));
  await page.keyboard.type(v.servico);
  await expect(l.getByRole('combobox', { name: 'Serviço' }).locator('option:checked')).toHaveText(new RegExp(`^${v.servico}`));
  await tabAte(page, l.getByRole('combobox', { name: 'Profissional' }));
  await page.keyboard.type(v.profissional);
  await expect(l.getByRole('combobox', { name: 'Profissional' }).locator('option:checked')).toHaveText(new RegExp(`^${v.profissional}`));
  await tabAte(page, l.getByRole('textbox', { name: /Hora/ }));
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type(v.hora);
}

/** Altura mínima de 44 px (critério 5). */
async function alvoMinimo(alvo: Locator, contexto: string) {
  const caixa = await alvo.boundingBox();
  expect(caixa, contexto).not.toBeNull();
  expect(caixa!.height, `${contexto}: altura`).toBeGreaterThanOrEqual(44);
}

test.describe('CA-36: reserva manual de 3 serviços com o teclado', () => {
  test('encaixe em 2 linhas: Enter num campo registra, aviso focado com a lista e uma caixa, e resultado', async ({ page }) => {
    const dia = proximaTerca();
    await abrir(page, `?data=${dia}`);
    await verificar(page, 'formulário inicial');

    await preencherLinha(page, 1, { servico: 'Escova', profissional: 'Ana', hora: '09:00' });
    const adicionar = page.getByRole('button', { name: 'Adicionar outro serviço' });
    await alvoMinimo(adicionar, '"Adicionar outro serviço"');
    await tabAte(page, adicionar);
    await page.keyboard.press('Enter');
    await expect(linha(page, 2)).toBeVisible();
    await expect(page.getByText('Linha de serviço adicionada.')).toBeAttached();
    await preencherLinha(page, 2, { servico: 'Hidratação', profissional: 'Bia', hora: '19:00' });
    await tabAte(page, adicionar);
    await page.keyboard.press('Enter');
    await expect(linha(page, 3)).toBeVisible();
    await preencherLinha(page, 3, { servico: 'Manicure', profissional: 'Carla', hora: '13:00' });
    await alvoMinimo(linha(page, 2).getByRole('button', { name: 'Remover serviço 2' }), '"Remover"');
    // Os valores das linhas anteriores sobreviveram às inclusões.
    await expect(linha(page, 1).getByRole('textbox', { name: /Hora/ })).toHaveValue('09:00');
    await expect(linha(page, 2).getByRole('textbox', { name: /Hora/ })).toHaveValue('19:00');

    await tabAte(page, page.getByLabel('Nome da cliente'));
    await page.keyboard.type('Maria Souza');
    await tabAte(page, page.getByLabel('Telefone (WhatsApp)'));
    await page.keyboard.type('11912345678');
    await verificar(page, 'nova reserva com 3 linhas');
    // Critério 24: Enter num campo de texto registra (botão padrão oculto), nunca adiciona nem remove linha.
    await page.keyboard.press('Enter');

    const aviso = page.locator('#reserva-aviso-encaixe');
    await expect(aviso).toBeVisible();
    await expect(aviso).toBeFocused();
    await expect(aviso.getByRole('listitem')).toHaveText([
      'Serviço 2 — Hidratação com Bia Demonstração às 19:00: fora da jornada.',
      'Serviço 3 — Manicure com Carla Demonstração às 13:00: horário bloqueado.',
    ]);
    await expect(linha(page, 3)).toBeVisible();
    await expect(linha(page, 4)).toHaveCount(0);
    await expect(page.getByLabel('Nome da cliente')).toHaveValue('Maria Souza');
    await expect(linha(page, 2).getByRole('textbox', { name: /Hora/ })).toHaveValue('19:00');
    await expect(page.getByRole('checkbox', { name: /Confirmo o encaixe/ })).toHaveCount(1);
    await verificar(page, 'aviso de encaixe');

    await tabAte(page, page.getByRole('checkbox', { name: 'Confirmo o encaixe destes serviços' }));
    await page.keyboard.press('Space');
    await tabAte(page, page.getByRole('button', { name: 'Registrar reserva' }));
    await page.keyboard.press('Enter');

    const criada = page.locator('#reserva-criada');
    await expect(criada).toBeFocused();
    await expect(criada).toContainText('Reserva registrada com encaixe em 2 serviços.');
    await expect(criada.getByRole('list', { name: 'Serviços da reserva' }).locator(':scope > li')).toHaveCount(3);
    await expect(page.getByRole('link', { name: 'Ver na agenda' })).toHaveAttribute('href', new RegExp(`data=${dia}`));
    await verificar(page, 'reserva criada');
  });

  test('horário normal: registrada sem pedir confirmação', async ({ page }) => {
    const dia = proximaTerca();
    await abrir(page, `?data=${dia}`);
    const l = linha(page, 1);
    await l.getByRole('combobox', { name: 'Serviço' }).selectOption({ index: 1 });
    await l.getByRole('combobox', { name: 'Profissional' }).selectOption({ label: 'Ana Demonstração' });
    await l.getByRole('textbox', { name: /Hora/ }).fill('10:00');
    await page.getByLabel('Nome da cliente').fill('Joana Lima');
    await page.getByLabel('Telefone (WhatsApp)').fill('(11) 98888-7777');
    await page.getByRole('button', { name: 'Registrar reserva' }).click();
    await expect(page.locator('#reserva-criada')).toContainText('Reserva registrada.');
    await expect(page.getByRole('checkbox', { name: /Confirmo o encaixe/ })).toHaveCount(0);
  });

  test('erros: resumo focado com links, campos ligados e axe sem violações', async ({ page }) => {
    await abrir(page);
    await page.getByRole('button', { name: 'Registrar reserva' }).click();
    const resumo = page.locator('#reserva-resumo-erros');
    await expect(resumo).toBeFocused();
    await expect(resumo).toContainText('Nome da cliente');
    await expect(page.getByLabel('Nome da cliente')).toHaveAttribute('aria-invalid', 'true');
    await verificar(page, 'erros');
    await resumo.getByRole('link', { name: /Nome da cliente/ }).click();
    await expect(page).toHaveURL(/#reserva-nome$/);
  });

  test('o passado é recusado mesmo com confirmação, no campo data', async ({ page }) => {
    await abrir(page, '?data=2020-01-07');
    const l = linha(page, 1);
    await l.getByRole('combobox', { name: 'Serviço' }).selectOption({ index: 1 });
    await l.getByRole('combobox', { name: 'Profissional' }).selectOption({ label: 'Ana Demonstração' });
    await l.getByRole('textbox', { name: /Hora/ }).fill('10:00');
    await page.getByLabel('Nome da cliente').fill('Maria Souza');
    await page.getByLabel('Telefone (WhatsApp)').fill('11912345678');
    await page.getByRole('button', { name: 'Registrar reserva' }).click();
    await expect(page.locator('#reserva-resumo-erros')).toContainText('não pode estar no passado');
  });

  test('modo profissional: sem seletor de profissional, só o de serviço', async ({ page }) => {
    await abrir(page, '?modo=profissional');
    await expect(page.getByRole('combobox', { name: 'Profissional' })).toHaveCount(0);
    await expect(linha(page, 1).getByRole('combobox', { name: 'Serviço' })).toBeVisible();
    await expect(page.getByText('Ana Demonstração')).toBeVisible();
    await verificar(page, 'modo profissional');
  });

  for (const vista of ['encaixe', 'erros', 'criada'] as const) {
    test(`vista ${vista}: axe sem violações, sem rolagem horizontal e sem "mesmo profissional"`, async ({ page }) => {
      await abrir(page, `?vista=${vista}`);
      await expect(page.getByRole('heading', { level: 1, name: 'Nova reserva' })).toBeVisible();
      await expect(page.getByText(/mesmo profissional/)).toHaveCount(0);
      await verificar(page, `vista ${vista}`);
    });
  }

  test('vista encaixe: lista "Serviço n — serviço com profissional às hh:mm: motivos" e uma única caixa (critério 25)', async ({ page }) => {
    await abrir(page, '?vista=encaixe');
    await expect(page.locator('#reserva-aviso-encaixe').getByRole('listitem')).toHaveText([
      'Serviço 2 — Hidratação com Bia Demonstração às 19:00: fora da jornada.',
      'Serviço 3 — Manicure com Carla Demonstração às 13:00: horário bloqueado; fora do funcionamento.',
    ]);
    await expect(page.getByRole('checkbox', { name: 'Confirmo o encaixe destes serviços' })).toHaveCount(1);
    for (const n of [1, 2, 3]) await alvoMinimo(linha(page, n).getByRole('button', { name: `Remover serviço ${n}` }), `"Remover" ${n}`);
  });
});

test.describe('CA-15: link "Nova reserva" na agenda', () => {
  test('leva à reserva manual com a data da vista', async ({ page }) => {
    const resposta = await page.goto('/dev/agenda');
    expect(resposta?.status()).toBe(200);
    const link = page.getByRole('link', { name: 'Nova reserva' });
    await expect(link).toBeVisible();
    const href = (await link.getAttribute('href'))!;
    expect(href).toMatch(/^\/dev\/reserva-nova\?data=\d{4}-\d{2}-\d{2}/);
    await link.click();
    await expect(page).toHaveURL(/\/dev\/reserva-nova\?data=/);
    await expect(page.getByRole('heading', { level: 1, name: 'Nova reserva' })).toBeVisible();
  });
});

// ── Com banco: o gestor cria a reserva de 3 itens em /painel/agenda/nova (CA-23) e a vê na agenda (CA-32) ──────

async function entrarComoGestor(page: Page, slug: string) {
  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(`gestor@${slug}.example`);
  await page.getByLabel('Senha').fill('Demo@12345');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/painel/);
}

async function escolherOpcao(select: Locator, inicio: string) {
  const rotulo = (await select.locator('option').filter({ hasText: new RegExp(`^${inicio}`) }).first().textContent())!;
  await select.selectOption({ label: rotulo });
}

type ItemComEncaixe = { servico: string; profissional: string; encaixe: boolean; status: string };

async function itensDaCliente(slug: string, e164: string): Promise<ItemComEncaixe[][]> {
  return comBanco(async (c) => {
    const r = await c.query(
      `SELECT r.id, json_agg(json_build_object('servico', s.nome, 'profissional', p.nome, 'encaixe', i.encaixe, 'status', i.status::text)
                ORDER BY i.inicio, i.id) AS itens
         FROM reserva r
         JOIN cliente c ON c.salao_id = r.salao_id AND c.id = r.cliente_id
         JOIN salao_slug sl ON sl.salao_id = r.salao_id AND sl.slug = $1
         JOIN reserva_item i ON i.salao_id = r.salao_id AND i.reserva_id = r.id
         JOIN servico s ON s.salao_id = i.salao_id AND s.id = i.servico_id
         JOIN profissional p ON p.salao_id = i.salao_id AND p.id = i.profissional_id
        WHERE c.telefone_e164 = $2 GROUP BY r.id`,
      [slug, e164],
    );
    return r.rows.map((x) => x.itens as ItemComEncaixe[]);
  });
}

test('CA-23/CA-32 (com banco): gestor cria 3 itens em 3 profissionais, um fora da jornada; sem confirmar nada é gravado', async ({ page }) => {
  const slug = 'e2e-reservas-8';
  const telefone = telefoneUnico();
  const dia = diaFuturo({ de: 2, ate: 13 });
  await entrarComoGestor(page, slug);
  await page.goto(`/painel/agenda/nova?data=${dia}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Nova reserva' })).toBeVisible();

  const linhas = [
    { servico: 'Escova', profissional: 'Bia', hora: '09:00' },
    { servico: 'Hidratação', profissional: 'Cris', hora: '10:00' },
    // A jornada é 08:00–12:00 e 13:00–20:00: 12:15 fica fora dela.
    { servico: 'Manicure', profissional: 'Duda', hora: '12:15' },
  ];
  for (const [k, v] of linhas.entries()) {
    if (k > 0) {
      await page.getByRole('button', { name: 'Adicionar outro serviço' }).click();
      await expect(linha(page, k + 1)).toBeVisible();
    }
    const l = linha(page, k + 1);
    await escolherOpcao(l.getByRole('combobox', { name: 'Serviço' }), v.servico);
    await l.getByRole('combobox', { name: 'Profissional' }).selectOption({ label: v.profissional });
    await l.getByRole('textbox', { name: /Hora/ }).fill(v.hora);
  }
  await page.getByLabel('Nome da cliente').fill('Cliente do Painel');
  await page.getByLabel('Telefone (WhatsApp)').fill(telefone.digitado);
  await page.getByRole('checkbox', { name: /mensagens da minha reserva/ }).check();
  const antes = await contarReservas(slug);
  await page.getByRole('button', { name: 'Registrar reserva' }).click();

  const aviso = page.locator('#reserva-aviso-encaixe');
  await expect(aviso.getByRole('listitem')).toHaveText(['Serviço 3 — Manicure com Duda às 12:15: fora da jornada.']);
  expect(await contarReservas(slug)).toBe(antes);
  expect(await itensDaCliente(slug, telefone.e164)).toEqual([]);
  await verificar(page, 'painel: aviso de encaixe');

  await page.getByRole('checkbox', { name: 'Confirmo o encaixe destes serviços' }).check();
  await page.getByRole('button', { name: 'Registrar reserva' }).click();
  await expect(page.locator('#reserva-criada')).toContainText('Reserva registrada com encaixe em 1 serviço.');
  expect(await itensDaCliente(slug, telefone.e164)).toEqual([
    [
      { servico: 'Escova', profissional: 'Bia', encaixe: false, status: 'confirmado' },
      { servico: 'Hidratação', profissional: 'Cris', encaixe: false, status: 'confirmado' },
      { servico: 'Manicure', profissional: 'Duda', encaixe: true, status: 'confirmado' },
    ],
  ]);

  // Agenda do dia: um bloco por item, cada um na coluna do seu profissional, todos levando ao mesmo detalhe.
  await page.getByRole('link', { name: 'Ver na agenda' }).click();
  const blocos = page.getByRole('link', { name: /Cliente do Painel/ });
  await expect(blocos).toHaveCount(3);
  const hrefs = await blocos.evaluateAll((els) => els.map((e) => e.getAttribute('href')!));
  const detalhes = new Set(hrefs.map((h) => h.split('#')[0]));
  expect(detalhes.size).toBe(1);
  for (const h of hrefs) expect(h).toMatch(/#item-[0-9a-f-]{36}$/);
  await expect(page.getByRole('link', { name: /Cliente do Painel · Manicure · Confirmado · Encaixe/ })).toHaveCount(1);
  await verificar(page, 'painel: agenda do dia');

  await blocos.first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Reserva' })).toBeVisible();
  const servicos = page.getByRole('list', { name: 'Serviços da reserva' }).locator(':scope > li');
  await expect(servicos).toHaveCount(3);
  await expect(servicos.nth(0)).toContainText('Escova');
  await expect(servicos.nth(0)).toContainText('com Bia');
  await expect(servicos.nth(2)).toContainText('Encaixe');
  await expect(page.getByText('R$ 180,00')).toBeVisible();
  await verificar(page, 'painel: detalhe com 3 itens');
});
