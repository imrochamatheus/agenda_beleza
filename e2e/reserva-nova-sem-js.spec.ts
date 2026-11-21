import { expect, test, type Page } from '@playwright/test';

// D-029 CA-16: a reserva manual funciona SEM JavaScript (POST de <form action> antes da hidratação). O
// primeiro envio fora do horário devolve, na própria resposta, o aviso com os motivos, a caixa "Confirmo o
// encaixe" e todos os dados; reenviar confirmado registra. Em /dev/reserva-nova (sem banco).

test.use({ javaScriptEnabled: false });

function proximaTerca(): string {
  for (let d = 7; d <= 13; d += 1) {
    const iso = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(Date.now() + d * 86_400_000));
    if (new Date(`${iso}T12:00:00Z`).getUTCDay() === 2) return iso;
  }
  throw new Error('sem terça-feira na janela');
}

async function enviar(page: Page) {
  const resposta = page.waitForResponse((r) => r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Registrar reserva' }).click();
  expect((await resposta).status()).toBe(200);
}

test.describe('CA-16: reserva manual sem JavaScript', () => {
  test('aviso na resposta, dados preservados e confirmação cria o encaixe', async ({ page }) => {
    const dia = proximaTerca();
    await page.goto(`/dev/reserva-nova?data=${dia}&hora=14:00`);
    await page.getByRole('combobox', { name: 'Profissional' }).selectOption({ label: 'Ana Demonstração' });
    await page.getByRole('checkbox', { name: /Corte feminino/ }).check();
    await page.getByLabel('Nome da cliente').fill('Maria Souza');
    await page.getByLabel('Telefone (WhatsApp)').fill('11912345678');
    await expect(page.getByRole('checkbox', { name: 'Confirmo o encaixe' })).toHaveCount(0);
    await enviar(page);

    await expect(page.locator('#reserva-aviso-encaixe')).toContainText('Horário bloqueado.');
    await expect(page.getByLabel('Nome da cliente')).toHaveValue('Maria Souza');
    await expect(page.getByLabel('Data')).toHaveValue(dia);
    await expect(page.getByLabel(/Hora/)).toHaveValue('14:00');
    await expect(page.getByRole('checkbox', { name: /Corte feminino/ })).toBeChecked();
    await expect(page.getByRole('combobox', { name: 'Profissional' })).toHaveValue('00000000-0000-4000-8000-00000000d029');

    await page.getByRole('checkbox', { name: 'Confirmo o encaixe' }).check();
    await enviar(page);
    await expect(page.locator('#reserva-criada')).toContainText('Reserva registrada como encaixe.');
    await expect(page.getByLabel('Nome da cliente')).toHaveValue('');
  });

  test('erros voltam na resposta com os valores preservados', async ({ page }) => {
    await page.goto('/dev/reserva-nova');
    await page.getByLabel('Nome da cliente').fill('Joana');
    await enviar(page);
    await expect(page.locator('#reserva-resumo-erros')).toContainText('Serviços');
    await expect(page.locator('#reserva-resumo-erros')).toContainText('Telefone');
    await expect(page.getByLabel('Nome da cliente')).toHaveValue('Joana');
  });
});
