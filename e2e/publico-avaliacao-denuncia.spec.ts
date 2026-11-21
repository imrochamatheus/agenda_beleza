import { expect, test } from '@playwright/test';

import { MENSAGENS_DENUNCIA } from '@/server/denuncias/tipos';

import { avaliacoesDoSalao, criarReservaConcluida, denunciasDoSalao } from './suporte/fixtures';
import { linkDeAvaliacao } from './suporte/link-avaliacao';
import { abrirSalao, verificarTela } from './suporte/publico';

// D-036 CA-20, CA-21 e CA-22: avaliação pelo link do convite (gerado sem worker, com o segredo público do E2E)
// de uma reserva `concluido` criada por fixture, exibição no perfil e denúncia. Salão /e2e-reservas-5.

const SLUG = 'e2e-reservas-5';
const COMENTARIO = `Atendimento excelente, volto sempre (${Date.now()}).`;

test('CA-20 e CA-21: avalia pelo link, a avaliação aparece no perfil, o link não vale duas vezes e a denúncia é registrada', async ({ page }) => {
  const { salaoId, reservaId } = await criarReservaConcluida(SLUG);
  const link = await linkDeAvaliacao(salaoId, reservaId);
  expect(link).toMatch(new RegExp(`^/${SLUG}/avaliar/[A-Za-z0-9_-]+$`));
  const antes = (await avaliacoesDoSalao(SLUG)).length;

  // CA-20: o formulário do convite.
  await page.goto(link);
  await expect(page.getByRole('heading', { level: 1, name: 'Avalie Salão E2E 5' })).toBeVisible();
  await verificarTela(page, 'avaliar');
  await page.getByRole('radio', { name: '5' }).check();
  await page.getByRole('textbox', { name: /Comentário/ }).fill(COMENTARIO);
  await page.getByRole('checkbox', { name: /publica/i }).check();
  await page.getByRole('button', { name: 'Enviar avaliação' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Avaliação enviada' })).toBeVisible();
  await verificarTela(page, 'avaliação enviada');

  const depois = await avaliacoesDoSalao(SLUG);
  expect(depois).toHaveLength(antes + 1);
  expect(depois[0]).toMatchObject({ nota: 5, comentario: COMENTARIO, retirada: false });

  // Exibição no perfil do salão.
  await abrirSalao(page, SLUG);
  const item = page.getByRole('listitem').filter({ hasText: COMENTARIO });
  await expect(item).toBeVisible();
  await expect(item).toContainText('Nota 5 de 5');

  // O mesmo link não permite uma segunda avaliação.
  await page.goto(link);
  await expect(page.getByRole('heading', { level: 1, name: 'Link inválido' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enviar avaliação' })).toHaveCount(0);
  expect(await avaliacoesDoSalao(SLUG)).toHaveLength(antes + 1);

  // CA-21: denúncia da avaliação publicada.
  await abrirSalao(page, SLUG);
  const alvo = page.getByRole('listitem').filter({ hasText: COMENTARIO });
  await alvo.getByText('Denunciar avaliação').click();
  await alvo.getByRole('radio', { name: 'Spam' }).check();
  await verificarTela(page, 'denúncia aberta');
  await alvo.getByRole('button', { name: 'Enviar denúncia' }).click();
  await expect(page.getByText(MENSAGENS_DENUNCIA.recebida)).toBeVisible();
  await verificarTela(page, 'denúncia recebida');

  const denuncias = await denunciasDoSalao(SLUG);
  expect(denuncias.filter((d) => d.motivo === 'spam' && d.pendente)).toHaveLength(1);
  // Continua publicada até a moderação.
  expect(denuncias.every((d) => d.avaliacaoPublicada)).toBe(true);
  await expect(page.getByText(COMENTARIO)).toBeVisible();
});
