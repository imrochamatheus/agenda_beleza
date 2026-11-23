import { expect, test, type Locator, type Page } from '@playwright/test';

import { analisarComAxe, semRolagemHorizontal } from './suporte/vitrine';

// D-030 CA-13 e D-050 CA-36 e critérios visuais 3–6, 19–22: remarcar, cancelar (por GET + POST, sem diálogo),
// "Cancelar todos" e marcar o resultado POR ITEM, só com o teclado, foco no aviso/resultado, axe sem violações e
// 375×812 sem rolagem horizontal. Em /dev/reserva-acoes (mesmos componentes do detalhe real, ações que só
// validam, sem banco): Escova com Ana 09:00, Hidratação com Bia 10:00 (cancelada) e Manicure com Carla 15:00
// (encaixe), daqui a uma semana; jornada seg–sáb 09:00–18:00.

async function abrir(page: Page, busca = '') {
  const resposta = await page.goto(`/dev/reserva-acoes${busca}`);
  if (resposta?.status() !== 200) {
    throw new Error(`/dev/reserva-acoes respondeu ${resposta?.status()}: ligue VITRINE_COMPONENTES=true ou libere a porta do E2E (E2E_PORT, padrão 3000).`);
  }
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

async function verificar(page: Page, contexto: string) {
  await semRolagemHorizontal(page, contexto);
  await analisarComAxe(page, contexto);
}

/** Tab até o alvo, conferindo o foco visível em cada parada. */
async function tabAte(page: Page, alvo: Locator, limite = 80) {
  for (let i = 0; i < limite; i += 1) {
    await page.keyboard.press('Tab');
    const f = await page.evaluate(() => {
      const e = document.activeElement as HTMLElement;
      const s = getComputedStyle(e);
      return { tag: e.tagName, texto: (e.textContent ?? '').trim().slice(0, 40), estilo: s.outlineStyle, contorno: parseFloat(s.outlineWidth) };
    });
    if (f.tag !== 'BODY') {
      expect(f.estilo, `foco visível em ${f.tag} "${f.texto}"`).not.toBe('none');
      expect(f.contorno, `contorno em ${f.tag} "${f.texto}"`).toBeGreaterThan(0);
    }
    if (await alvo.evaluate((e) => e === document.activeElement)) return;
  }
  throw new Error('alvo não alcançado por Tab');
}

/** Altura mínima de 2,75 rem = 44 px (critério 5). */
async function alvosMinimos(page: Page, contexto: string) {
  const pequenos = await page
    .locator('main ol[aria-label="Serviços da reserva"] a, main ol[aria-label="Serviços da reserva"] button, main a[href*="cancelar=todos"]')
    .evaluateAll((els) =>
      els
        .map((e) => ({ t: (e.textContent ?? '').trim(), h: e.getBoundingClientRect().height }))
        .filter(({ h }) => h < 44)
        .map(({ t, h }) => `${t} ${Math.round(h)}px`),
    );
  expect(pequenos, contexto).toEqual([]);
}

const servicos = (page: Page) => page.getByRole('list', { name: 'Serviços da reserva' }).locator(':scope > li');

test.describe('CA-36: ações por item com o teclado', () => {
  test('detalhe: um item por parada, cancelado riscado fora do total, alvos ≥ 44 px, axe', async ({ page }) => {
    await abrir(page);
    await expect(servicos(page)).toHaveCount(3);
    await expect(page.getByRole('term')).toHaveText(['Cliente', 'Telefone', 'Data', 'Situação', 'Origem']);
    await expect(servicos(page).nth(1)).toContainText('Cancelado');
    const riscado = await servicos(page).nth(1).getByText('Hidratação', { exact: true }).evaluate((e) => getComputedStyle(e).textDecorationLine);
    expect(riscado).toContain('line-through');
    await expect(page.getByText('Itens cancelados não entram no total.')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Marcar / })).toHaveCount(0);
    await alvosMinimos(page, 'detalhe');
    await verificar(page, 'detalhe com 3 itens');
  });

  test('remarcar um item com encaixe: um só formulário, data como texto, aviso focado e resultado', async ({ page }) => {
    await abrir(page);
    await tabAte(page, page.getByRole('link', { name: 'Remarcar Escova (09:00)' }));
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/remarcar=item-escova/);
    await expect(page.getByRole('heading', { level: 3, name: 'Remarcar Escova' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Remarcar serviço' })).toHaveCount(1);
    // Com outro item não cancelado, a data é texto (RN-22), não campo.
    await expect(page.getByText(/a mesma dos outros serviços/)).toBeVisible();
    await expect(page.locator('input[type="date"]')).toHaveCount(0);
    await verificar(page, 'remarcar aberto');

    const hora = page.getByRole('textbox', { name: /Hora/ });
    await tabAte(page, hora);
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type('19:00');
    await page.keyboard.press('Enter');

    const aviso = page.locator('#remarcar-aviso-encaixe');
    await expect(aviso).toBeVisible();
    await expect(aviso).toBeFocused();
    await expect(aviso).toContainText('Fora da jornada do profissional.');
    await expect(hora).toHaveValue('19:00');
    await verificar(page, 'aviso de encaixe');

    await tabAte(page, page.getByRole('checkbox', { name: 'Confirmo o encaixe' }));
    await page.keyboard.press('Space');
    await tabAte(page, page.getByRole('button', { name: 'Remarcar serviço' }));
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/resultado=remarcado.*item=item-escova.*#resultado$/);
    await expect(page.locator('#resultado')).toContainText(/Escova \(09:00\) foi remarcado para \d{2}:\d{2} com Ana Demonstração\./);
    await analisarComAxe(page, 'depois de remarcar');
  });

  test('remarcar: hora inválida vira resumo focado; "Fechar" volta à parada', async ({ page }) => {
    await abrir(page, '?remarcar=item-manicure');
    const hora = page.getByRole('textbox', { name: /Hora/ });
    await hora.fill('25:00');
    await page.getByRole('button', { name: 'Remarcar serviço' }).click();
    const resumo = page.locator('#remarcar-resumo-erros');
    await expect(resumo).toBeFocused();
    await expect(hora).toHaveValue('25:00');
    await verificar(page, 'erros do remarcar');
    await page.getByRole('link', { name: 'Fechar' }).click();
    await expect(page).toHaveURL(/#item-item-manicure$/);
    await expect(page.getByRole('button', { name: 'Remarcar serviço' })).toHaveCount(0);
  });

  test('cancelar um item em dois passos, sem diálogo: confirmação, "Manter serviço" volta, confirmar cancela', async ({ page }) => {
    await abrir(page);
    await tabAte(page, page.getByRole('link', { name: 'Cancelar Manicure (15:00)' }));
    await page.keyboard.press('Enter');
    const confirmacao = page.getByRole('group', { name: /^Cancelar Manicure \(15:00/ });
    await expect(confirmacao).toBeVisible();
    await expect(page.locator('dialog')).toHaveCount(0);
    await verificar(page, 'confirmar cancelamento do item');
    await tabAte(page, page.getByRole('link', { name: 'Manter serviço' }));
    await page.keyboard.press('Enter');
    await expect(confirmacao).toHaveCount(0);

    await page.getByRole('link', { name: 'Cancelar Manicure (15:00)' }).click();
    await tabAte(page, page.getByRole('button', { name: 'Sim, cancelar este serviço' }));
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/resultado=cancelado/);
    await expect(page.locator('#resultado')).toContainText('Manicure (15:00) foi cancelado. A cliente será avisada se tiver aceitado as mensagens.');
  });

  test('"Cancelar todos os serviços": GET abre a confirmação com os canceláveis, POST cancela com uma mensagem', async ({ page }) => {
    await abrir(page);
    await tabAte(page, page.getByRole('link', { name: 'Cancelar todos os serviços' }));
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/cancelar=todos/);
    const confirmacao = page.getByRole('group', { name: /^Cancelar os 2 serviços que ainda podem ser cancelados \(Escova 09:00, Manicure 15:00\)/ });
    await expect(confirmacao).toBeVisible();
    await verificar(page, 'confirmar cancelar todos');
    await tabAte(page, page.getByRole('button', { name: 'Sim, cancelar todos' }));
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/resultado=todos_cancelados/);
    await expect(page.locator('#resultado')).toContainText('2 serviços cancelados. A cliente receberá uma única mensagem.');
  });

  test('item iniciado: "Concluído" e "Não compareceu" por item, nomeados pelo serviço', async ({ page }) => {
    await abrir(page, '?vista=iniciada');
    await verificar(page, 'reserva iniciada');
    await alvosMinimos(page, 'reserva iniciada');
    await expect(page.getByRole('button', { name: /^Marcar / })).toHaveCount(2);
    const concluir = page.getByRole('button', { name: 'Marcar Escova como concluído' });
    await expect(concluir).toHaveText('Concluído');
    await tabAte(page, concluir);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/resultado=concluido/);
    await expect(page.locator('#resultado')).toContainText('Escova marcado como concluído.');

    await abrir(page, '?vista=iniciada');
    await page.getByRole('button', { name: 'Marcar Escova como não compareceu' }).click();
    await expect(page).toHaveURL(/resultado=nao_compareceu/);
    await expect(page.locator('#resultado')).toContainText('Escova marcado como não compareceu.');
  });

  test('profissional: só o próprio item, a frase e sem "Cancelar todos"', async ({ page }) => {
    await abrir(page, '?vista=profissional');
    await expect(page.getByText('Você vê apenas os seus serviços nesta reserva.')).toBeVisible();
    await expect(servicos(page)).toHaveCount(1);
    await expect(page.getByText('Total dos seus serviços')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Cancelar todos os serviços' })).toHaveCount(0);
    for (const outro of ['Hidratação', 'Manicure']) await expect(page.getByText(outro)).toHaveCount(0);
    await verificar(page, 'profissional');
  });

  test('reserva cancelada: nenhuma ação', async ({ page }) => {
    await abrir(page, '?vista=cancelada');
    await expect(page.getByRole('link', { name: /^(Remarcar|Cancelar) / })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Marcar / })).toHaveCount(0);
    await verificar(page, 'cancelada');
  });
});
