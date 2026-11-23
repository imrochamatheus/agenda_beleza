import { expect, test } from '@playwright/test';

import { comBanco, contarReservas } from './suporte/fixtures';
import { abrirSalao, verificarTela } from './suporte/publico';

// D-036 CA-18 e CA-22: salão suspenso manualmente (`suspenso_manual_em`, 3º salão do complemento do E2E): o perfil
// segue visível, mas sem formulário de reserva. D-050 CA-14: nem uma URL forjada com serviço, dia e item (h0)
// abre um passo de agendamento.

test('CA-18: perfil, fotos e avaliações visíveis; "Agendamento indisponível" e nenhum formulário de reserva', async ({ page }) => {
  await abrirSalao(page, 'e2e-suspenso');
  await expect(page.getByRole('heading', { level: 1, name: 'Salão E2E Suspenso' })).toBeVisible();
  await expect(page.getByText('Agendamento indisponível')).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Avaliações' })).toBeVisible();
  await expect(page.getByText('Paula T.')).toBeVisible();
  await expect(page.getByRole('img').first()).toBeVisible();

  await expect(page.getByRole('button', { name: 'Continuar' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Confirmar reserva' })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: /^Corte\b/ })).toHaveCount(0);
  await verificarTela(page, 'salão suspenso');
});

test('CA-14: URL forjada com serviço, dia e item não abre o agendamento nem grava nada', async ({ page }) => {
  const slug = 'e2e-suspenso';
  const { servico, profissional } = await comBanco(async (c) => {
    const r = await c.query(
      `SELECT v.id AS servico, p.id AS profissional FROM salao_slug sl
         JOIN servico v ON v.salao_id = sl.salao_id AND v.nome = 'Corte'
         JOIN profissional p ON p.salao_id = sl.salao_id AND p.nome = 'Ana'
        WHERE sl.slug = $1`,
      [slug],
    );
    return r.rows[0] as { servico: string; profissional: string };
  });
  const amanha = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(Date.now() + 86_400_000));
  const antes = await contarReservas(slug);
  await abrirSalao(page, slug, `?s=${servico}&data=${amanha}&h0=${profissional}_${amanha}T13:00:00.000Z`);
  await expect(page.getByText('Agendamento indisponível')).toBeVisible();
  await expect(page.getByRole('radio')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Confirmar reserva' })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: /Nome/ })).toHaveCount(0);
  expect(await contarReservas(slug)).toBe(antes);
});
