import { expect, test, type Page } from '@playwright/test';

import { diaFuturo, irParaSemanaDoDia, linkDoDia, marcarComSetas, noPassoDoServico, paradasDoRoteiro, radioDoHorario, tabAte } from './suporte/publico';
import { analisarComAxe, semRolagemHorizontal } from './suporte/vitrine';

// D-026 CA-12 e D-050 critérios visuais 3–6, 9, 10, 12, 15 e 16: o fluxo da página pública de reserva só com o
// teclado em /dev/reserva (mesmos componentes da página real, dados em memória, sem banco), em 375×812: sem rolagem
// horizontal e axe 4.14.0 sem violações em cada passo, foco visível em cada parada. Exemplo do web-design: Escova
// (Ana, Bia), Hidratação (as três) e Manicure (só Carla); segunda a sábado. A variante sem JavaScript está em
// reserva-publica-sem-js.spec.ts.

async function abrir(page: Page, busca = '') {
  const resposta = await page.goto(`/dev/reserva${busca}`);
  if (resposta?.status() !== 200) {
    throw new Error(`/dev/reserva respondeu ${resposta?.status()}: ligue VITRINE_COMPONENTES=true ou libere a porta do E2E (E2E_PORT, padrão 3000).`);
  }
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

async function verificar(page: Page, contexto: string) {
  await semRolagemHorizontal(page, contexto);
  await analisarComAxe(page, contexto);
}

/** Alvos de pelo menos 44 px de altura (critério 5). */
async function alvoMinimo(page: Page, alvo: ReturnType<Page['getByRole']>, contexto: string) {
  const caixa = await alvo.boundingBox();
  expect(caixa, contexto).not.toBeNull();
  expect(caixa!.height, `${contexto}: altura`).toBeGreaterThanOrEqual(44);
}

test.describe('CA-12: reserva completa só com o teclado (375×812)', () => {
  test('serviços → dia → um passo por serviço (filtro e setas) → dados (erro e correção) → confirmação', async ({ page }) => {
    const dia = diaFuturo({ de: 1, ate: 13, semana: [1, 2, 3, 4, 5, 6] });
    await abrir(page);
    await expect(page.getByRole('heading', { level: 1, name: /Studio Bela/ })).toBeVisible();
    await verificar(page, 'perfil e serviços');

    for (const nome of ['Escova', 'Hidratação', 'Manicure']) {
      const caixa = page.getByRole('checkbox', { name: new RegExp(`^${nome}\\b`) });
      await tabAte(page, caixa);
      await page.keyboard.press('Space');
      await expect(caixa).toBeChecked();
    }
    await tabAte(page, page.getByRole('button', { name: 'Continuar' }));
    await page.keyboard.press('Enter');

    // D-051: a régua fica no passo do 1º serviço; a semana do dia é alcançada por "Próxima semana" (Tab + Enter).
    await noPassoDoServico(page, 'Escova', 1, 3);
    await verificar(page, 'passo 0 sem dia');
    await irParaSemanaDoDia(page, dia, { teclado: true });
    await tabAte(page, linkDoDia(page, dia));
    await page.keyboard.press('Enter');

    // Serviço 1: Escova (Ana, Bia). O filtro é navegação; o atual tem aria-current (critério 10).
    await noPassoDoServico(page, 'Escova', 1, 3);
    await verificar(page, 'serviço 1');
    const filtro = page.getByRole('navigation', { name: 'Filtrar por profissional' });
    await expect(filtro.getByRole('link', { name: 'Todos (2)' })).toHaveAttribute('aria-current', 'true');
    await alvoMinimo(page, filtro.getByRole('link', { name: 'Ana', exact: true }), 'pílula do filtro');
    // Todas as grades do serviço partilham um único `name` (uma parada de Tab por serviço).
    const nomes = await page.getByRole('group', { name: /^Horários de / }).getByRole('radio').evaluateAll((els) => [...new Set(els.map((e) => (e as HTMLInputElement).name))]);
    expect(nomes).toEqual(['h0']);
    await tabAte(page, page.getByRole('group', { name: 'Horários de Ana' }).getByRole('radio').first());
    await marcarComSetas(page, radioDoHorario(page, 'Ana', '09:00'));
    await tabAte(page, page.getByRole('button', { name: 'Continuar' }));
    await page.keyboard.press('Enter');

    // Serviço 2: Hidratação; usa o filtro (Tab + Enter) para ir direto à Bia.
    await noPassoDoServico(page, 'Hidratação', 2, 3);
    await verificar(page, 'serviço 2');
    const bia = page.getByRole('navigation', { name: 'Filtrar por profissional' }).getByRole('link', { name: 'Bia', exact: true });
    await tabAte(page, bia);
    await page.keyboard.press('Enter');
    await expect(bia).toHaveAttribute('aria-current', 'true');
    await expect(page.getByRole('group', { name: /^Horários de / })).toHaveCount(1);
    await alvoMinimo(page, page.getByRole('link', { name: /^Alterar Escova/ }), '"Alterar"');
    await tabAte(page, page.getByRole('group', { name: 'Horários de Bia' }).getByRole('radio').first());
    await marcarComSetas(page, radioDoHorario(page, 'Bia', '10:00'));
    await tabAte(page, page.getByRole('button', { name: 'Continuar' }));
    await page.keyboard.press('Enter');

    // Serviço 3: Manicure, só Carla (sem filtro).
    await noPassoDoServico(page, 'Manicure', 3, 3);
    await verificar(page, 'serviço 3');
    await expect(page.getByRole('navigation', { name: 'Filtrar por profissional' })).toHaveCount(0);
    await tabAte(page, page.getByRole('group', { name: 'Horários de Carla' }).getByRole('radio').first());
    await marcarComSetas(page, radioDoHorario(page, 'Carla', '15:00'));
    await tabAte(page, page.getByRole('button', { name: 'Continuar para seus dados' }));
    await page.keyboard.press('Enter');

    // Dados: envio vazio mostra erros por campo.
    await expect(page.getByRole('heading', { level: 2, name: 'Seus dados' })).toBeVisible();
    expect(await paradasDoRoteiro(page)).toEqual([
      expect.stringMatching(/^09:00 .*Escova .*com Ana/),
      expect.stringMatching(/^10:00 .*Hidratação .*com Bia/),
      expect.stringMatching(/^15:00 .*Manicure .*com Carla/),
    ]);
    await verificar(page, 'passo dados');
    await tabAte(page, page.getByRole('button', { name: 'Confirmar reserva' }));
    await page.keyboard.press('Enter');
    await expect(page.getByText('Informe', { exact: false }).first()).toBeVisible();
    await verificar(page, 'passo dados com erros');

    await page.getByRole('textbox', { name: /Nome/ }).fill('Maria da Silva');
    await page.getByRole('textbox', { name: /Telefone/ }).fill('(11) 98765-4321');
    const aceite = page.getByRole('checkbox', { name: /mensagens da minha reserva/ });
    await tabAte(page, aceite);
    await page.keyboard.press('Space');
    await expect(aceite).toBeChecked();
    await tabAte(page, page.getByRole('button', { name: 'Confirmar reserva' }));
    await page.keyboard.press('Enter');

    await expect(page.getByText('Reserva confirmada!')).toBeVisible();
    expect(await paradasDoRoteiro(page)).toEqual([
      expect.stringMatching(/^09:00.*10:00 .*Escova .*com Ana/),
      expect.stringMatching(/^10:00.*10:40 .*Hidratação .*com Bia/),
      expect.stringMatching(/^15:00.*15:45 .*Manicure .*com Carla/),
    ]);
    await expect(page.getByRole('region', { name: 'Sua reserva' }).getByText('R$ 205,00')).toBeVisible();
    await verificar(page, 'confirmação');
  });

  for (const [vista, titulo] of [
    ['reescolha', 'Escolha outro horário para Hidratação'],
    ['confirmada', 'Sua reserva'],
    ['conflito', 'Hidratação'],
  ] as const) {
    test(`vista ${vista}: axe sem violações e sem rolagem horizontal`, async ({ page }) => {
      await abrir(page, `?vista=${vista}`);
      await expect(page.getByRole('heading', { level: 2, name: titulo, exact: true })).toBeVisible();
      await verificar(page, `vista ${vista}`);
    });
  }

  test('reescolha: o aviso nomeia o serviço e o horário; os dados voltam preenchidos (critério 15)', async ({ page }) => {
    await abrir(page, '?vista=reescolha');
    await expect(page.getByRole('status')).toContainText('O horário das 10:00 de Hidratação com Bia acabou de ser reservado.');
    await expect(page.getByRole('textbox', { name: /Nome/ })).toHaveValue('Maria Souza');
    await expect(page.getByRole('textbox', { name: /Telefone/ })).not.toHaveValue('');
    await expect(page.getByRole('checkbox', { name: /mensagens da minha reserva/ })).toBeChecked();
    // Os itens mantidos ficam no roteiro, sem "Alterar".
    await expect(page.getByRole('link', { name: /^Alterar / })).toHaveCount(0);
  });

  test('conflito: os horários do serviço coincidem com os já escolhidos → vazio com as saídas', async ({ page }) => {
    await abrir(page, '?vista=conflito');
    await expect(page.getByRole('heading', { level: 3, name: /coincidem com os serviços que você já escolheu/ })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Escolher outro dia' })).toBeVisible();
    await expect(page.getByRole('radio')).toHaveCount(0);
  });

  test('vista indisponível: aviso, sem formulário, axe sem violações', async ({ page }) => {
    await abrir(page, '?vista=indisponivel');
    await expect(page.getByText('Agendamento indisponível')).toBeVisible();
    await expect(page.locator('form')).toHaveCount(0);
    await verificar(page, 'indisponível');
  });

  test('vista de perfil vazio: sem seções vazias e sem "undefined"/"null"', async ({ page }) => {
    await abrir(page, '?vista=vazio');
    await expect(page.getByRole('heading', { name: 'Endereço' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Equipe' })).toHaveCount(0);
    const texto = await page.locator('main').innerText();
    expect(texto).not.toMatch(/undefined|null/);
    await verificar(page, 'perfil vazio');
  });

  test('parâmetros malformados na URL voltam ao passo anterior, sem erro', async ({ page }) => {
    await abrir(page, '?s=lixo&p=x&data=2026-02-30&h0=amanha');
    await expect(page.getByRole('heading', { level: 2, name: 'Serviços' })).toBeVisible();
    await abrir(page, '?s=11111111-1111-4111-8111-111111111111&data=nao&h0=x');
    // D-051: sem data válida, o passo do 1º serviço sem dia (régua e "escolha um dia").
    await expect(page.getByRole('heading', { level: 2, name: 'Escova' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 3, name: 'Escolha um dia para ver os horários' })).toBeVisible();
  });
});
