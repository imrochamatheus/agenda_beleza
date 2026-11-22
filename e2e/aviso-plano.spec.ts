import { expect, test } from '@playwright/test';

import { analisarComAxe, semRolagemHorizontal } from './suporte/vitrine';

// D-038 CA-11: a faixa do plano no painel (vitrine /dev/aviso-plano, sem banco), 375x812. Cada texto da RN-11
// aparece no estado certo e some nos demais; a data sai no fuso do salão (30/11, não 01/12); axe 4.14.0 sem
// violações; alcançável por teclado (o link "Pular" é o 1º foco e a faixa não rouba o foco).

const TEXTOS: Record<string, string> = {
  pendente: 'Assinatura pendente. Você já pode configurar o salão, mas o agendamento fica indisponível até a assinatura ser ativada.',
  em_carencia: 'Pagamento não confirmado. Seu acesso continua normal até 30/11/2026; regularize para evitar a suspensão.',
  cancelada: 'Assinatura cancelada. Você pode usar o painel até 30/11/2026.',
  suspensa: 'Assinatura suspensa. O painel está somente leitura e o agendamento está indisponível. Você ainda pode cancelar reservas futuras.',
  encerrada: 'Assinatura encerrada. Painel somente leitura; o agendamento está indisponível.',
  manual: 'Salão suspenso pela administração. Painel somente leitura; você ainda pode cancelar reservas futuras. Entre em contato com o suporte.',
};
const SEM_FAIXA = ['sem_assinatura', 'em_teste', 'ativa'];

async function abrir(page: import('@playwright/test').Page, busca: string) {
  const r = await page.goto(`/dev/aviso-plano${busca}`);
  if (r?.status() !== 200) throw new Error(`/dev/aviso-plano respondeu ${r?.status()}: ligue VITRINE_COMPONENTES=true ou libere a porta 3000.`);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

test.describe('faixa do plano no painel', () => {
  for (const [estado, texto] of Object.entries(TEXTOS)) {
    test(`${estado}: mostra o texto exato com role=status e some nos demais`, async ({ page }) => {
      await abrir(page, `?estado=${estado}`);
      const faixa = page.getByRole('status');
      await expect(faixa).toHaveCount(1);
      await expect(faixa).toContainText(texto);
      await expect(faixa).toContainText(/Atenção:|Informação:/);
      for (const [outro, t] of Object.entries(TEXTOS)) {
        if (outro !== estado) await expect(page.getByText(t, { exact: false })).toHaveCount(0);
      }
      await semRolagemHorizontal(page, estado);
    });
  }

  for (const estado of SEM_FAIXA) {
    test(`${estado}: sem faixa`, async ({ page }) => {
      await abrir(page, `?estado=${estado}`);
      await expect(page.getByRole('status')).toHaveCount(0);
      await expect(page.getByTestId('faixa-do-plano')).toHaveCount(0);
    });
  }

  test('profissional: texto sem frase administrativa e com "Fale com o gestor do salão."', async ({ page }) => {
    await abrir(page, '?estado=manual&papel=profissional');
    const faixa = page.getByRole('status');
    await expect(faixa).toContainText('Fale com o gestor do salão.');
    await expect(faixa).not.toContainText('suporte');
  });

  test('teclado: o primeiro foco é o link de pular e a faixa não captura o foco', async ({ page }) => {
    await abrir(page, '?estado=suspensa');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Pular para o conteúdo' })).toBeFocused();
    const noFoco = await page.evaluate(() => document.querySelector('[data-testid="faixa-do-plano"]')?.contains(document.activeElement));
    expect(noFoco).toBe(false);
  });

  for (const estado of [...Object.keys(TEXTOS), 'ativa']) {
    test(`axe sem violações em ${estado}`, async ({ page }) => {
      await abrir(page, `?estado=${estado}`);
      await analisarComAxe(page, estado);
    });
  }
});
