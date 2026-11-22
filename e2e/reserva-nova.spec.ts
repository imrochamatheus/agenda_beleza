import { expect, test, type Page } from '@playwright/test';

import { analisarComAxe, semRolagemHorizontal } from './suporte/vitrine';

// D-029 CA-15 e CA-16: reserva manual da equipe só com o teclado, foco no aviso de encaixe e no resultado,
// axe sem violações e 375×812 sem rolagem horizontal. Roda em /dev/reserva-nova (mesmos componentes da
// página real, ação que só valida, sem banco). Demonstração: jornada seg–sáb 09:00–18:00, funcionamento
// seg–sex 08:00–20:00, bloqueio 14:00–15:00 só da Ana.

/** Próxima terça-feira (AAAA-MM-DD) de 7 a 13 dias à frente, no fuso do salão. */
function proximaTerca(): string {
  for (let d = 7; d <= 13; d += 1) {
    const dia = new Date(Date.now() + d * 86_400_000);
    const iso = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(dia);
    if (new Date(`${iso}T12:00:00Z`).getUTCDay() === 2) return iso;
  }
  throw new Error('sem terça-feira na janela');
}

async function abrir(page: Page, busca = '') {
  const resposta = await page.goto(`/dev/reserva-nova${busca}`);
  if (resposta?.status() !== 200) {
    throw new Error(`/dev/reserva-nova respondeu ${resposta?.status()}: ligue VITRINE_COMPONENTES=true ou libere a porta do E2E (E2E_PORT, padrão 3000).`);
  }
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

type Focado = { tag: string; id: string; estilo: string; contorno: number };
const focado = (page: Page): Promise<Focado> =>
  page.evaluate(() => {
    const e = document.activeElement as HTMLElement;
    const s = getComputedStyle(e);
    return { tag: e.tagName, id: e.id, estilo: s.outlineStyle, contorno: parseFloat(s.outlineWidth) };
  });

/**
 * Tab até o elemento com o id; confere o foco visível em cada parada. O seletor de data nativo tem várias
 * paradas internas (dia, mês, ano e o botão do calendário) com o mesmo `activeElement`: só a primeira é conferida.
 */
async function tabAte(page: Page, id: string, limite = 40) {
  let vistoNaData = false;
  for (let i = 0; i < limite; i += 1) {
    await page.keyboard.press('Tab');
    const f = await focado(page);
    const repetidaNaData = f.id === 'reserva-data' && vistoNaData;
    if (f.id === 'reserva-data') vistoNaData = true;
    if (f.tag !== 'BODY' && !repetidaNaData) {
      expect(f.estilo, `foco visível em ${f.tag}#${f.id}`).not.toBe('none');
      expect(f.contorno, `contorno em ${f.tag}#${f.id}`).toBeGreaterThan(0);
    }
    if (f.id === id) return;
  }
  throw new Error(`#${id} não alcançado por Tab`);
}

async function digitar(page: Page, valor: string) {
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type(valor);
}

test.describe('CA-16: reserva manual com o teclado', () => {
  test('encaixe: aviso focado, confirmação por Espaço e reserva registrada como encaixe', async ({ page }) => {
    const dia = proximaTerca();
    await abrir(page, `?data=${dia}&profissional=00000000-0000-4000-8000-00000000d029`);
    await analisarComAxe(page, 'formulário inicial');
    await semRolagemHorizontal(page, 'formulário inicial');

    await tabAte(page, 'reserva-servico-00000000-0000-4000-8000-0000000000a1');
    await page.keyboard.press('Space');
    await tabAte(page, 'reserva-hora');
    await digitar(page, '18:30');
    await tabAte(page, 'reserva-nome');
    await page.keyboard.type('Maria Souza');
    await tabAte(page, 'reserva-telefone');
    await page.keyboard.type('11912345678');
    await tabAte(page, 'reserva-consentimento-mensagens');
    await page.keyboard.press('Space');
    await page.getByRole('button', { name: 'Registrar reserva' }).focus();
    await page.keyboard.press('Enter');

    const aviso = page.locator('#reserva-aviso-encaixe');
    await expect(aviso).toBeVisible();
    await expect(aviso).toBeFocused();
    await expect(aviso).toContainText('Fora da jornada do profissional.');
    await expect(page.getByLabel('Nome da cliente')).toHaveValue('Maria Souza');
    await expect(page.getByLabel(/Hora/)).toHaveValue('18:30');
    await analisarComAxe(page, 'aviso de encaixe');
    await semRolagemHorizontal(page, 'aviso de encaixe');

    await tabAte(page, 'reserva-confirmar-encaixe');
    await page.keyboard.press('Space');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Registrar reserva' })).toBeFocused();
    await page.keyboard.press('Enter');

    const criada = page.locator('#reserva-criada');
    await expect(criada).toBeFocused();
    await expect(criada).toContainText('Reserva registrada como encaixe.');
    await expect(page.getByRole('link', { name: 'Ver na agenda' })).toHaveAttribute('href', new RegExp(`data=${dia}`));
    await analisarComAxe(page, 'reserva criada');
  });

  test('horário normal: registrada sem pedir confirmação', async ({ page }) => {
    const dia = proximaTerca();
    await abrir(page, `?data=${dia}&hora=10:00`);
    await page.getByRole('combobox', { name: 'Profissional' }).selectOption({ label: 'Ana Demonstração' });
    await page.getByRole('checkbox', { name: /Corte feminino/ }).check();
    await page.getByLabel('Nome da cliente').fill('Joana Lima');
    await page.getByLabel('Telefone (WhatsApp)').fill('(11) 98888-7777');
    await page.getByRole('button', { name: 'Registrar reserva' }).click();
    await expect(page.locator('#reserva-criada')).toContainText('Reserva registrada.');
    await expect(page.getByRole('checkbox', { name: 'Confirmo o encaixe' })).toHaveCount(0);
  });

  test('erros: resumo focado com links, campos ligados e axe sem violações', async ({ page }) => {
    await abrir(page);
    await page.getByRole('button', { name: 'Registrar reserva' }).click();
    const resumo = page.locator('#reserva-resumo-erros');
    await expect(resumo).toBeFocused();
    await expect(resumo).toContainText('Serviços');
    await expect(resumo).toContainText('Nome da cliente');
    await expect(page.getByLabel('Nome da cliente')).toHaveAttribute('aria-invalid', 'true');
    await analisarComAxe(page, 'erros');
    await semRolagemHorizontal(page, 'erros');
    await resumo.getByRole('link', { name: /Nome da cliente/ }).click();
    await expect(page).toHaveURL(/#reserva-nome$/);
  });

  test('o passado é recusado mesmo com confirmação, no campo data', async ({ page }) => {
    await abrir(page, '?data=2020-01-07&hora=10:00');
    await page.getByRole('combobox', { name: 'Profissional' }).selectOption({ label: 'Ana Demonstração' });
    await page.getByRole('checkbox', { name: /Escova/ }).check();
    await page.getByLabel('Nome da cliente').fill('Maria Souza');
    await page.getByLabel('Telefone (WhatsApp)').fill('11912345678');
    await page.getByRole('button', { name: 'Registrar reserva' }).click();
    await expect(page.locator('#reserva-resumo-erros')).toContainText('não pode estar no passado');
  });

  test('modo profissional: sem seletor, agenda própria', async ({ page }) => {
    await abrir(page, '?modo=profissional');
    await expect(page.getByRole('combobox', { name: 'Profissional' })).toHaveCount(0);
    await expect(page.getByText('Ana Demonstração')).toBeVisible();
    await analisarComAxe(page, 'modo profissional');
  });
});

test.describe('CA-15: link "Nova reserva" na agenda', () => {
  test('leva à reserva manual com a data da vista e o profissional do filtro', async ({ page }) => {
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
