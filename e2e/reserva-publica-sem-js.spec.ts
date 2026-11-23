import { expect, test, type Page } from '@playwright/test';

import { diaFuturo, escolherDia, escolherHorarioDe, noPassoDoServico, paradasDoRoteiro, radioDoHorario } from './suporte/publico';
import { semRolagemHorizontal } from './suporte/vitrine';

// D-026 CA-12 e D-050 critérios 15 e 16 (sem JavaScript) em /dev/reserva: cada passo é um GET (formulário
// `method=get` ou link: filtro, "Alterar") e o último é o POST de uma Server Action. Erros por campo preservam os
// valores digitados; o sucesso mostra a confirmação com o roteiro dos 3 serviços.

test.use({ javaScriptEnabled: false });

const continuar = (page: Page) => page.getByRole('button', { name: 'Continuar' }).click();

test.describe('CA-12: reserva sem JavaScript', () => {
  test('fluxo completo com filtro e "Alterar", erro por campo com valores preservados e confirmação', async ({ page }) => {
    const dia = diaFuturo({ de: 1, ate: 13, semana: [1, 2, 3, 4, 5, 6] });
    const resposta = await page.goto('/dev/reserva');
    expect(resposta?.status()).toBe(200);

    for (const nome of ['Escova', 'Hidratação', 'Manicure']) await page.getByRole('checkbox', { name: new RegExp(`^${nome}\\b`) }).check();
    await continuar(page);
    await expect(page).toHaveURL(/\/dev\/reserva\?s=.*&s=.*&s=/);
    await escolherDia(page, dia);
    await expect(page).toHaveURL(new RegExp(`data=${dia}`));

    await noPassoDoServico(page, 'Escova', 1, 3);
    await semRolagemHorizontal(page, 'serviço 1 sem JS');
    await escolherHorarioDe(page, 'Ana', '09:00');
    await continuar(page);
    await expect(page).toHaveURL(/h0=/);

    // O filtro é um link (GET) e preserva o item já escolhido.
    await noPassoDoServico(page, 'Hidratação', 2, 3);
    await page.getByRole('navigation', { name: 'Filtrar por profissional' }).getByRole('link', { name: 'Bia', exact: true }).click();
    await expect(page.getByRole('group', { name: /^Horários de / })).toHaveCount(1);
    await expect(page.getByRole('link', { name: 'Alterar Escova (09:00 com Ana)' })).toBeVisible();
    await escolherHorarioDe(page, 'Bia', '10:00');
    await continuar(page);

    await noPassoDoServico(page, 'Manicure', 3, 3);
    await escolherHorarioDe(page, 'Carla', '16:00');
    await continuar(page);
    await expect(page.getByRole('heading', { level: 2, name: 'Seus dados' })).toBeVisible();
    await expect(page).toHaveURL(/h2=/);

    // "Alterar" da Manicure: volta ao passo dela com o horário pré-selecionado; a troca mantém os outros itens.
    await page.getByRole('link', { name: 'Alterar Manicure (16:00 com Carla)' }).click();
    await noPassoDoServico(page, 'Manicure', 3, 3);
    await expect(radioDoHorario(page, 'Carla', '16:00')).toBeChecked();
    await escolherHorarioDe(page, 'Carla', '15:00');
    await continuar(page);
    expect(await paradasDoRoteiro(page)).toEqual([
      expect.stringMatching(/^09:00 .*Escova .*com Ana/),
      expect.stringMatching(/^10:00 .*Hidratação .*com Bia/),
      expect.stringMatching(/^15:00 .*Manicure .*com Carla/),
    ]);
    await semRolagemHorizontal(page, 'dados sem JS');

    // Erro: telefone inválido e sem aceite; nome e telefone voltam preenchidos.
    await page.getByRole('textbox', { name: /Nome/ }).fill('Maria da Silva');
    await page.getByRole('textbox', { name: /Telefone/ }).fill('123');
    const envio = page.waitForResponse((r) => r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Confirmar reserva' }).click();
    expect((await envio).status()).toBe(200);
    await expect(page.getByText('Erro:').first()).toBeVisible();
    await expect(page.getByRole('textbox', { name: /Nome/ })).toHaveValue('Maria da Silva');
    await expect(page.getByRole('textbox', { name: /Telefone/ })).toHaveValue('123');

    // Corrige e confirma.
    await page.getByRole('textbox', { name: /Telefone/ }).fill('(11) 98765-4321');
    await page.getByRole('checkbox', { name: /mensagens da minha reserva/ }).check();
    const envio2 = page.waitForResponse((r) => r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Confirmar reserva' }).click();
    expect((await envio2).status()).toBe(200);
    await expect(page.getByText('Reserva confirmada!')).toBeVisible();
    expect(await paradasDoRoteiro(page)).toHaveLength(3);
    await expect(page.getByRole('region', { name: 'Sua reserva' }).getByText('R$ 205,00')).toBeVisible();
    await semRolagemHorizontal(page, 'confirmação sem JS');
  });

  test('reescolha sem JavaScript: aviso, dados preservados e só o item aberto tem grades', async ({ page }) => {
    await page.goto('/dev/reserva?vista=reescolha');
    await expect(page.getByRole('heading', { level: 2, name: 'Escolha outro horário para Hidratação' })).toBeVisible();
    await expect(page.getByText(/O horário das 10:00 de Hidratação com Bia acabou de ser reservado\./)).toBeVisible();
    await expect(page.getByRole('textbox', { name: /Nome/ })).toHaveValue('Maria Souza');
    await expect(page.getByRole('checkbox', { name: /mensagens da minha reserva/ })).toBeChecked();
    const nomes = await page.getByRole('radio').evaluateAll((els) => [...new Set(els.map((e) => (e as HTMLInputElement).name))]);
    expect(nomes).toEqual(['h1']);
    await semRolagemHorizontal(page, 'reescolha sem JS');
  });

  test('indisponível: perfil e aviso, sem formulário', async ({ page }) => {
    await page.goto('/dev/reserva?vista=indisponivel');
    await expect(page.getByText('Agendamento indisponível')).toBeVisible();
    await expect(page.locator('form')).toHaveCount(0);
  });
});
