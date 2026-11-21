import { expect, test, type Page } from '@playwright/test';

import { contarReservas, ocuparHorario, reservasDoTelefone, telefoneUnico } from './suporte/fixtures';
import { semRolagemHorizontal } from './suporte/vitrine';
import {
  abrirSalao, confirmar, continuar, escolherDia, escolherHorario, escolherProfissional, escolherServicos,
  preencherDados, seletorDeCaptcha, verificarTela,
} from './suporte/publico';

// D-036 CA-16, CA-17 e CA-22: horário tomado entre a escolha e o envio, e captcha inválido pelo widget simulado.

/**
 * CA-16 (DEF-1): o horário é tomado entre a escolha e o envio. A resposta volta à etapa do horário, com os horários
 * atualizados, serviço/profissional/dia preservados e nome, telefone e aceite PREENCHIDOS (no estado do formulário,
 * nunca na URL); reescolher outro horário confirma a reserva.
 */
async function conflitoDeHorario(page: Page, slug: string, indiceDoDia: number, comJs = true) {
  const telefone = telefoneUnico();
  await abrirSalao(page, slug);
  await escolherServicos(page, ['Corte']);
  await continuar(page);
  await escolherProfissional(page, 'Ana');
  await continuar(page);
  await escolherDia(page, indiceDoDia);
  const inicio = await escolherHorario(page, 0);
  await continuar(page);
  await preencherDados(page, { nome: 'Cliente Atrasada', telefone: telefone.digitado });

  // Outra cliente fica com o horário (a inserção passa pela exclusão reserva_sem_sobreposicao).
  const antes = await contarReservas(slug);
  await ocuparHorario(slug, 'Ana', new Date(inicio), 60);
  expect(await contarReservas(slug)).toBe(antes + 1);
  await confirmar(page);

  await expect(page.getByText('Este horário não está mais disponível. Escolha outro horário.')).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Escolha o horário' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Resumo da escolha' })).toContainText('Corte');
  // Dados preservados no formulário (e fora da URL).
  await expect(page.getByRole('textbox', { name: /Nome/ })).toHaveValue('Cliente Atrasada');
  await expect(page.getByRole('textbox', { name: /Telefone/ })).toHaveValue(telefone.digitado);
  await expect(page.getByRole('checkbox', { name: /mensagens da minha reserva/ })).toBeChecked();
  expect(page.url()).not.toMatch(/Atrasada|98765|nome=|telefone=/);
  // Horários atualizados: o tomado saiu da lista.
  const radios = page.getByRole('radio', { name: /^\d{2}:\d{2}$/ });
  await expect(radios.first()).toBeVisible();
  expect(await radios.evaluateAll((els, v) => els.map((e) => (e as HTMLInputElement).value).includes(v), inicio)).toBe(false);
  // O axe injeta script: sem JavaScript só se confere a rolagem (como nos demais specs sem JS).
  if (comJs) await verificarTela(page, 'volta ao horário');
  else await semRolagemHorizontal(page, 'volta ao horário sem JS');
  expect(await reservasDoTelefone(slug, telefone.e164)).toHaveLength(0);
  expect(await contarReservas(slug)).toBe(antes + 1);

  // Reescolhe outro horário e confirma sem redigitar nada.
  const novo = radios.first();
  const novoInicio = await novo.inputValue();
  await novo.check();
  await confirmar(page);
  await expect(page.getByText('Reserva confirmada!')).toBeVisible();
  const reservas = await reservasDoTelefone(slug, telefone.e164);
  expect(reservas).toHaveLength(1);
  expect(reservas[0]!.inicio.toISOString()).toBe(novoInicio);
  expect(novoInicio).not.toBe(inicio);
  expect(await contarReservas(slug)).toBe(antes + 2);
}

test('CA-16: horário tomado antes do envio → "horário indisponível", reescolha com nome e telefone preservados', async ({ page }) => {
  await conflitoDeHorario(page, 'e2e-reservas-3', 2);
});

test.describe('sem JavaScript', () => {
  test.use({ javaScriptEnabled: false });
  test('CA-16: o mesmo conflito, por POST sem JavaScript, preserva os dados e permite reescolher', async ({ page }) => {
    await conflitoDeHorario(page, 'e2e-reservas-6', 3, false);
  });
});

test('CA-17: token de captcha inválido → mensagem de captcha e nenhuma reserva', async ({ page }) => {
  const slug = 'e2e-reservas-4';
  const telefone = telefoneUnico();
  await abrirSalao(page, slug);
  await escolherServicos(page, ['Escova']);
  await continuar(page);
  await escolherProfissional(page, null);
  await continuar(page);
  await escolherDia(page, 1);
  await escolherHorario(page, 0);
  await continuar(page);
  await preencherDados(page, { nome: 'Cliente Robô', telefone: telefone.digitado, token: 'invalido' });
  const antes = await contarReservas(slug);
  await confirmar(page);

  await expect(page.getByText('Não foi possível confirmar que você é uma pessoa. Tente novamente.')).toBeVisible();
  await expect(page.getByText('Reserva confirmada!')).toHaveCount(0);
  await verificarTela(page, 'captcha recusado');
  expect(await reservasDoTelefone(slug, telefone.e164)).toHaveLength(0);
  expect(await contarReservas(slug)).toBe(antes);

  // Com o token válido a mesma tela confirma: a recusa era só do captcha.
  await seletorDeCaptcha(page).selectOption({ label: 'Token válido' });
  await confirmar(page);
  await expect(page.getByText('Reserva confirmada!')).toBeVisible();
  expect(await reservasDoTelefone(slug, telefone.e164)).toHaveLength(1);
});
