import { expect, test, type Page } from '@playwright/test';

import { analisarComAxe, semRolagemHorizontal } from './suporte/vitrine';

// D-030 CA-13: remarcar, cancelar (dois passos, sem diálogo) e marcar o resultado só com o teclado, foco no
// aviso/resultado, axe sem violações e 375×812 sem rolagem horizontal. Em /dev/reserva-acoes (mesmos componentes
// do detalhe real, ações que só validam, sem banco). Jornada da Ana: seg–sáb 09:00–18:00.

/** Próxima terça-feira (AAAA-MM-DD) de 14 a 20 dias à frente, no fuso do salão (depois da reserva de exemplo). */
function proximaTerca(): string {
  for (let d = 14; d <= 20; d += 1) {
    const iso = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(Date.now() + d * 86_400_000));
    if (new Date(`${iso}T12:00:00Z`).getUTCDay() === 2) return iso;
  }
  throw new Error('sem terça-feira na janela');
}

async function abrir(page: Page, busca = '') {
  const resposta = await page.goto(`/dev/reserva-acoes${busca}`);
  if (resposta?.status() !== 200) {
    throw new Error(`/dev/reserva-acoes respondeu ${resposta?.status()}: ligue VITRINE_COMPONENTES=true ou libere a porta 3000.`);
  }
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

/** Tab até o elemento com o id, conferindo o foco visível em cada parada (a data nativa tem várias paradas). */
async function tabAte(page: Page, id: string, limite = 60) {
  let vistoNaData = id !== 'remarcar-data';
  for (let i = 0; i < limite; i += 1) {
    await page.keyboard.press('Tab');
    const f = await page.evaluate(() => {
      const e = document.activeElement as HTMLElement;
      const s = getComputedStyle(e);
      return { tag: e.tagName, id: e.id, estilo: s.outlineStyle, contorno: parseFloat(s.outlineWidth) };
    });
    const repetida = f.id === 'remarcar-data' && vistoNaData;
    if (f.id === 'remarcar-data') vistoNaData = true;
    if (f.tag !== 'BODY' && !repetida) {
      expect(f.estilo, `foco visível em ${f.tag}#${f.id}`).not.toBe('none');
      expect(f.contorno, `contorno em ${f.tag}#${f.id}`).toBeGreaterThan(0);
    }
    if (f.id === id) return;
  }
  throw new Error(`#${id} não alcançado por Tab`);
}

test.describe('CA-13: ações da reserva com o teclado', () => {
  test('remarcar com encaixe: aviso focado, confirmação por Espaço e resultado', async ({ page }) => {
    const dia = proximaTerca();
    await abrir(page);
    await analisarComAxe(page, 'detalhe com ações');
    await semRolagemHorizontal(page, 'detalhe com ações');
    await expect(page.getByRole('button', { name: /Marcar como/ })).toHaveCount(0);

    await tabAte(page, 'remarcar-data');
    // fill() é independente da ordem dia/mês do locale do navegador (digitar ddmmyyyy falha em en-US, como na CI).
    await page.getByLabel('Nova data').fill(dia);
    await tabAte(page, 'remarcar-hora');
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type('19:00');
    await page.getByRole('button', { name: 'Remarcar reserva' }).focus();
    await page.keyboard.press('Enter');

    const aviso = page.locator('#remarcar-aviso-encaixe');
    await expect(aviso).toBeVisible();
    await expect(aviso).toBeFocused();
    await expect(aviso).toContainText('Fora da jornada do profissional.');
    await expect(page.getByLabel(/Nova hora/)).toHaveValue('19:00');
    await analisarComAxe(page, 'aviso de encaixe');
    await semRolagemHorizontal(page, 'aviso de encaixe');

    await tabAte(page, 'remarcar-confirmar-encaixe');
    await page.keyboard.press('Space');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Remarcar reserva' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/resultado=remarcada/);
    await expect(page.getByRole('status')).toContainText('Reserva atualizada.');
    await analisarComAxe(page, 'depois de remarcar');
  });

  test('erros: serviço desmarcado vira resumo focado com link e axe sem violações', async ({ page }) => {
    await abrir(page);
    await page.getByRole('checkbox', { name: /Corte feminino/ }).uncheck();
    await page.getByRole('button', { name: 'Remarcar reserva' }).click();
    const resumo = page.locator('#remarcar-resumo-erros');
    await expect(resumo).toBeFocused();
    await expect(resumo).toContainText('Serviços');
    await analisarComAxe(page, 'erros');
    await semRolagemHorizontal(page, 'erros');
    await resumo.getByRole('link', { name: /Serviços/ }).click();
    await expect(page).toHaveURL(/#remarcar-servicos$/);
  });

  test('cancelar em dois passos, sem diálogo: confirmação focada, "Manter reserva" volta e confirmar cancela', async ({ page }) => {
    await abrir(page);
    await page.getByRole('button', { name: 'Cancelar reserva' }).focus();
    await page.keyboard.press('Enter');
    const confirmacao = page.locator('#cancelar-confirmacao');
    await expect(confirmacao).toBeFocused();
    await analisarComAxe(page, 'confirmar cancelamento');
    await semRolagemHorizontal(page, 'confirmar cancelamento');
    await page.getByRole('button', { name: 'Manter reserva' }).click();
    await expect(page.locator('#cancelar-confirmacao')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Cancelar reserva' })).toBeVisible();

    await page.getByRole('button', { name: 'Cancelar reserva' }).click();
    await page.getByRole('button', { name: 'Confirmar cancelamento' }).click();
    await expect(page).toHaveURL(/resultado=cancelada/);
    await expect(page.getByRole('status')).toContainText('Reserva cancelada.');
    await expect(page.getByRole('button', { name: /Remarcar|Cancelar|Marcar/ })).toHaveCount(0);
  });

  test('reserva iniciada: marcar como concluída (e, na concluída, só "não compareceu")', async ({ page }) => {
    await abrir(page, '?vista=iniciada');
    await analisarComAxe(page, 'reserva iniciada');
    await page.getByRole('button', { name: 'Marcar como concluída' }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/resultado=concluida/);
    await expect(page.getByRole('status')).toContainText('Reserva marcada como concluída.');

    await abrir(page, '?vista=concluida');
    await expect(page.getByRole('button', { name: 'Marcar como concluída' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Remarcar reserva' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Marcar como não compareceu' }).click();
    await expect(page).toHaveURL(/resultado=nao_compareceu/);
  });

  test('reserva cancelada: nenhuma ação', async ({ page }) => {
    await abrir(page, '?vista=cancelada');
    await expect(page.getByRole('button', { name: /Remarcar|Cancelar|Marcar/ })).toHaveCount(0);
    await analisarComAxe(page, 'cancelada');
  });
});
