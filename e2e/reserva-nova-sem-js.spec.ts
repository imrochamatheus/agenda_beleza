import { expect, test, type Page } from '@playwright/test';

import { diaFuturo } from './suporte/publico';
import { semRolagemHorizontal } from './suporte/vitrine';

// D-029 CA-16 e D-050 CA-36 e critérios 23–25: a reserva manual funciona SEM JavaScript (POST de <form action>
// antes da hidratação). "Adicionar outro serviço" e "Remover" são envios do mesmo formulário e preservam tudo o
// que foi digitado; o Enter num campo de texto registra; o aviso de encaixe volta na resposta com a lista e uma
// única caixa, e reenviar confirmado registra. Em /dev/reserva-nova (sem banco).

test.use({ javaScriptEnabled: false });

const proximaTerca = (): string => diaFuturo({ de: 7, ate: 13, semana: [2] });

const linha = (page: Page, n: number) => page.getByRole('group', { name: `Serviço ${n}`, exact: true });

async function enviar(page: Page, botao: string | RegExp) {
  const resposta = page.waitForResponse((r) => r.request().method() === 'POST');
  await page.getByRole('button', { name: botao }).click();
  expect((await resposta).status()).toBe(200);
}

async function preencherLinha(page: Page, n: number, v: { servico: string; profissional: string; hora: string }) {
  const l = linha(page, n);
  const rotulo = (await l.getByRole('combobox', { name: 'Serviço' }).locator('option').filter({ hasText: new RegExp(`^${v.servico}`) }).textContent())!;
  await l.getByRole('combobox', { name: 'Serviço' }).selectOption({ label: rotulo });
  await l.getByRole('combobox', { name: 'Profissional' }).selectOption({ label: v.profissional });
  await l.getByRole('textbox', { name: /Hora/ }).fill(v.hora);
}

async function valoresDaLinha(page: Page, n: number) {
  const l = linha(page, n);
  return {
    servico: (await l.getByRole('combobox', { name: 'Serviço' }).locator('option:checked').textContent())!.split(' · ')[0],
    profissional: await l.getByRole('combobox', { name: 'Profissional' }).locator('option:checked').textContent(),
    hora: await l.getByRole('textbox', { name: /Hora/ }).inputValue(),
  };
}

test.describe('CA-36: reserva manual sem JavaScript', () => {
  test('adicionar 2 linhas e remover a do meio preserva data, linhas, nome, telefone e consentimento', async ({ page }) => {
    const dia = proximaTerca();
    await page.goto(`/dev/reserva-nova?data=${dia}`);
    await expect(linha(page, 1)).toBeVisible();
    await expect(page.getByRole('button', { name: /^Remover/ })).toHaveCount(0);
    await preencherLinha(page, 1, { servico: 'Escova', profissional: 'Ana Demonstração', hora: '09:00' });
    await page.getByLabel('Nome da cliente').fill('Maria Souza');
    await page.getByLabel('Telefone (WhatsApp)').fill('11912345678');
    await page.getByRole('checkbox', { name: /mensagens da minha reserva/ }).check();

    await enviar(page, 'Adicionar outro serviço');
    await expect(page.getByText('Linha de serviço adicionada.')).toBeVisible();
    await preencherLinha(page, 2, { servico: 'Hidratação', profissional: 'Bia Demonstração', hora: '10:00' });
    await enviar(page, 'Adicionar outro serviço');
    await preencherLinha(page, 3, { servico: 'Manicure', profissional: 'Carla Demonstração', hora: '15:00' });
    await expect(linha(page, 3)).toBeVisible();
    await semRolagemHorizontal(page, 'nova reserva com 3 linhas sem JS');

    await enviar(page, 'Remover serviço 2');
    await expect(page.getByText('Serviço 2 removido.')).toBeVisible();
    await expect(linha(page, 3)).toHaveCount(0);
    expect(await valoresDaLinha(page, 1)).toEqual({ servico: 'Escova', profissional: 'Ana Demonstração', hora: '09:00' });
    expect(await valoresDaLinha(page, 2)).toEqual({ servico: 'Manicure', profissional: 'Carla Demonstração', hora: '15:00' });
    await expect(page.getByLabel('Data')).toHaveValue(dia);
    await expect(page.getByLabel('Nome da cliente')).toHaveValue('Maria Souza');
    await expect(page.getByLabel('Telefone (WhatsApp)')).toHaveValue('11912345678');
    await expect(page.getByRole('checkbox', { name: /mensagens da minha reserva/ })).toBeChecked();
    // Nada foi registrado por adicionar ou remover.
    await expect(page.locator('#reserva-criada')).toHaveCount(0);
    await expect(page.locator('#reserva-resumo-erros')).toHaveCount(0);
  });

  test('"Adicionar outro serviço" some com 10 linhas; "Remover" só aparece com 2 ou mais', async ({ page }) => {
    await page.goto('/dev/reserva-nova');
    for (let n = 2; n <= 10; n += 1) {
      await enviar(page, 'Adicionar outro serviço');
      await expect(linha(page, n)).toBeVisible();
    }
    await expect(page.getByRole('button', { name: 'Adicionar outro serviço' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Remover serviço/ })).toHaveCount(10);
    await enviar(page, 'Remover serviço 10');
    await expect(page.getByRole('button', { name: 'Adicionar outro serviço' })).toHaveCount(1);
  });

  test('Enter num campo de texto registra (nunca adiciona nem remove linha)', async ({ page }) => {
    await page.goto('/dev/reserva-nova');
    await enviar(page, 'Adicionar outro serviço');
    await page.getByLabel('Nome da cliente').fill('Joana');
    const resposta = page.waitForResponse((r) => r.request().method() === 'POST');
    await linha(page, 1).getByRole('textbox', { name: /Hora/ }).press('Enter');
    expect((await resposta).status()).toBe(200);
    await expect(page.locator('#reserva-resumo-erros')).toBeVisible();
    await expect(page.getByText('Linha de serviço adicionada.')).toHaveCount(0);
    await expect(page.getByText(/removido\./)).toHaveCount(0);
    await expect(linha(page, 2)).toBeVisible();
    await expect(linha(page, 3)).toHaveCount(0);
    await expect(page.getByLabel('Nome da cliente')).toHaveValue('Joana');
  });

  test('aviso de encaixe na resposta, com a lista e uma caixa; confirmar registra', async ({ page }) => {
    const dia = proximaTerca();
    await page.goto(`/dev/reserva-nova?data=${dia}`);
    await preencherLinha(page, 1, { servico: 'Escova', profissional: 'Ana Demonstração', hora: '09:00' });
    await enviar(page, 'Adicionar outro serviço');
    await preencherLinha(page, 2, { servico: 'Manicure', profissional: 'Carla Demonstração', hora: '13:00' });
    await page.getByLabel('Nome da cliente').fill('Maria Souza');
    await page.getByLabel('Telefone (WhatsApp)').fill('11912345678');
    await expect(page.getByRole('checkbox', { name: /Confirmo o encaixe/ })).toHaveCount(0);
    await enviar(page, 'Registrar reserva');

    await expect(page.locator('#reserva-aviso-encaixe').getByRole('listitem')).toHaveText([
      'Serviço 2 — Manicure com Carla Demonstração às 13:00: horário bloqueado.',
    ]);
    await expect(page.getByLabel('Nome da cliente')).toHaveValue('Maria Souza');
    await expect(page.getByLabel('Data')).toHaveValue(dia);
    expect(await valoresDaLinha(page, 2)).toEqual({ servico: 'Manicure', profissional: 'Carla Demonstração', hora: '13:00' });
    await semRolagemHorizontal(page, 'aviso de encaixe sem JS');

    await page.getByRole('checkbox', { name: 'Confirmo o encaixe destes serviços' }).check();
    await enviar(page, 'Registrar reserva');
    await expect(page.locator('#reserva-criada')).toContainText('Reserva registrada com encaixe em 1 serviço.');
    await expect(page.getByLabel('Nome da cliente')).toHaveValue('');
  });

  test('erros voltam na resposta com os valores preservados', async ({ page }) => {
    await page.goto('/dev/reserva-nova');
    await page.getByLabel('Nome da cliente').fill('Joana');
    await enviar(page, 'Registrar reserva');
    await expect(page.locator('#reserva-resumo-erros')).toContainText('Telefone');
    await expect(page.getByLabel('Nome da cliente')).toHaveValue('Joana');
  });
});
