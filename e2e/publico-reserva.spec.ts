import { expect, test } from '@playwright/test';

import { reservasDoTelefone, telefoneUnico } from './suporte/fixtures';
import {
  abrirSalao, confirmar, continuar, escolherDia, escolherHorario, escolherProfissional, escolherServicos,
  preencherDados, profissionaisOferecidos, verificarTela,
} from './suporte/publico';

// D-036 CA-14, CA-15 e CA-22: reserva multi-serviço na página pública REAL (/studio-aurora, semeada), com o
// Turnstile simulado válido; só este arquivo reserva no salão A.

test('CA-14: perfil → 2 serviços → profissional → dia → horário → dados → confirmação, com 2 itens em sequência', async ({ page }) => {
  const telefone = telefoneUnico();
  await abrirSalao(page, 'studio-aurora');
  await expect(page.getByRole('heading', { level: 1, name: 'Studio Aurora' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Avaliações' })).toBeVisible();
  await expect(page.getByText('Ana C.')).toBeVisible();
  await verificarTela(page, 'perfil e serviços');

  await escolherServicos(page, ['Corte feminino', 'Escova']);
  await continuar(page);
  await verificarTela(page, 'passo profissional');

  await escolherProfissional(page, 'Marcos Pires');
  await continuar(page);
  await verificarTela(page, 'passo dia');

  await escolherDia(page, 6);
  await verificarTela(page, 'passo horário');
  const inicio = await escolherHorario(page, 0);
  await continuar(page);

  await preencherDados(page, { nome: 'Maria Teste E2E', telefone: telefone.digitado });
  await verificarTela(page, 'passo dados');
  await confirmar(page);

  await expect(page.getByText('Reserva confirmada!')).toBeVisible();
  await expect(page.getByText('Profissional: Marcos Pires')).toBeVisible();
  await verificarTela(page, 'confirmação');

  const reservas = await reservasDoTelefone('studio-aurora', telefone.e164);
  expect(reservas).toHaveLength(1);
  const [r] = reservas;
  expect(r!.status).toBe('confirmado');
  expect(r!.inicio.toISOString()).toBe(inicio);
  expect(r!.itens).toEqual([
    { servico: 'Corte feminino', ordem: 0, precoCentavos: 9000, duracaoMin: 60 },
    { servico: 'Escova', ordem: 1, precoCentavos: 5500, duracaoMin: 30 },
  ]);
  // Em sequência: a reserva dura a soma das durações.
  expect(r!.fim.getTime() - r!.inicio.getTime()).toBe(90 * 60_000);
});

test('CA-15: só aparecem os profissionais que fazem TODOS os serviços escolhidos', async ({ page }) => {
  await abrirSalao(page, 'studio-aurora');
  await escolherServicos(page, ['Corte feminino', 'Escova']);
  await continuar(page);
  expect(await profissionaisOferecidos(page)).toEqual(['Helena Moura', 'Marcos Pires']);
  await verificarTela(page, 'profissionais de corte e escova');

  await page.goto('/studio-aurora');
  await escolherServicos(page, ['Corte feminino', 'Manicure']);
  await continuar(page);
  expect(await profissionaisOferecidos(page)).toEqual(['Helena Moura']);

  await page.goto('/studio-aurora');
  await escolherServicos(page, ['Manicure', 'Hidratação']);
  await continuar(page);
  expect(await profissionaisOferecidos(page)).toEqual(['Beatriz Lima', 'Helena Moura']);
});
