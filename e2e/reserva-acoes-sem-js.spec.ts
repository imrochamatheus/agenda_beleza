import { expect, test, type Page } from '@playwright/test';

// D-030 CA-13: remarcar, cancelar (dois passos) e marcar o resultado funcionam SEM JavaScript (POST de
// <form action> antes da hidratação). Erros e avisos voltam na resposta (200); o sucesso é PRG (?resultado=).
// Em /dev/reserva-acoes (sem banco).

test.use({ javaScriptEnabled: false });

function proximaTerca(): string {
  for (let d = 14; d <= 20; d += 1) {
    const iso = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(Date.now() + d * 86_400_000));
    if (new Date(`${iso}T12:00:00Z`).getUTCDay() === 2) return iso;
  }
  throw new Error('sem terça-feira na janela');
}

async function enviar(page: Page, botao: string) {
  const resposta = page.waitForResponse((r) => r.request().method() === 'POST');
  await page.getByRole('button', { name: botao }).click();
  return resposta;
}

test.describe('CA-13: ações da reserva sem JavaScript', () => {
  test('remarcar: aviso de encaixe na resposta, dados preservados e confirmação cria o resultado', async ({ page }) => {
    const dia = proximaTerca();
    await page.goto('/dev/reserva-acoes');
    await page.getByLabel('Nova data').fill(dia);
    await page.getByLabel(/Nova hora/).fill('19:00');
    expect((await enviar(page, 'Remarcar reserva')).status()).toBe(200);
    await expect(page.locator('#remarcar-aviso-encaixe')).toContainText('Fora da jornada do profissional.');
    await expect(page.getByLabel('Nova data')).toHaveValue(dia);
    await expect(page.getByLabel(/Nova hora/)).toHaveValue('19:00');
    await expect(page.getByRole('checkbox', { name: /Corte feminino/ })).toBeChecked();

    await page.getByRole('checkbox', { name: 'Confirmo o encaixe' }).check();
    await enviar(page, 'Remarcar reserva');
    await expect(page).toHaveURL(/resultado=remarcada/);
    await expect(page.getByRole('status')).toContainText('Reserva atualizada.');
  });

  test('remarcar: erro volta na resposta com os valores preservados', async ({ page }) => {
    await page.goto('/dev/reserva-acoes');
    await page.getByRole('checkbox', { name: /Corte feminino/ }).uncheck();
    await page.getByLabel(/Nova hora/).fill('11:00');
    expect((await enviar(page, 'Remarcar reserva')).status()).toBe(200);
    await expect(page.locator('#remarcar-resumo-erros')).toContainText('Serviços');
    await expect(page.getByLabel(/Nova hora/)).toHaveValue('11:00');
  });

  test('cancelar em dois passos: o primeiro POST pede a confirmação; "Manter reserva" volta; confirmar cancela', async ({ page }) => {
    await page.goto('/dev/reserva-acoes');
    expect((await enviar(page, 'Cancelar reserva')).status()).toBe(200);
    await expect(page.locator('#cancelar-confirmacao')).toBeVisible();
    await enviar(page, 'Manter reserva');
    await expect(page.locator('#cancelar-confirmacao')).toHaveCount(0);
    await enviar(page, 'Cancelar reserva');
    await enviar(page, 'Confirmar cancelamento');
    await expect(page).toHaveURL(/resultado=cancelada/);
    await expect(page.getByRole('status')).toContainText('Reserva cancelada.');
  });

  test('marcar como não compareceu, em reserva iniciada', async ({ page }) => {
    await page.goto('/dev/reserva-acoes?vista=iniciada');
    await enviar(page, 'Marcar como não compareceu');
    await expect(page).toHaveURL(/resultado=nao_compareceu/);
    await expect(page.getByRole('status')).toContainText('não compareceu');
  });
});
