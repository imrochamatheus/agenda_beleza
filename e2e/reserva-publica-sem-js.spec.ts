import { expect, test, type Page } from '@playwright/test';

// D-026 CA-12 (sem JavaScript): cada passo é um GET (formulário `method=get` ou link) e o último é o POST de
// uma Server Action. Erros por campo preservam os valores digitados; o sucesso mostra a confirmação.

test.use({ javaScriptEnabled: false });

const continuar = (page: Page) => page.getByRole('button', { name: 'Continuar' }).click();

test.describe('CA-12: reserva sem JavaScript', () => {
  test('fluxo completo, erro por campo com valores preservados e confirmação', async ({ page }) => {
    const resposta = await page.goto('/dev/reserva');
    expect(resposta?.status()).toBe(200);

    await page.getByRole('checkbox', { name: /Corte feminino/ }).check();
    await page.getByRole('checkbox', { name: /Escova/ }).check();
    await continuar(page);
    await expect(page).toHaveURL(/\/dev\/reserva\?s=.*&s=/);

    // Quem faz os dois serviços: Ana e Bia, mais "Sem preferência".
    await expect(page.getByRole('radio')).toHaveCount(3);
    await page.getByRole('radio', { name: 'Ana' }).check();
    await continuar(page);

    await page.getByRole('list').getByRole('link', { name: /\d{2}\/\d{2}\/\d{4}$/ }).first().click();
    await expect(page).toHaveURL(/data=\d{4}-\d{2}-\d{2}/);

    await page.getByRole('radio').first().check();
    await continuar(page);
    await expect(page.getByRole('heading', { level: 2, name: 'Seus dados' })).toBeVisible();
    await expect(page).toHaveURL(/h=/);

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
    await expect(page.getByText('Profissional: Ana')).toBeVisible();
    await expect(page.getByText(/Total:/)).toContainText('R$');
  });

  test('indisponível: perfil e aviso, sem formulário', async ({ page }) => {
    await page.goto('/dev/reserva?vista=indisponivel');
    await expect(page.getByText('Agendamento indisponível')).toBeVisible();
    await expect(page.locator('form')).toHaveCount(0);
  });
});
