import { expect, test, type Page } from '@playwright/test';

import { comBanco, reservasDoTelefone, telefoneUnico } from './suporte/fixtures';
import { diaFuturo, linkDoDia, marcarComSetas, noPassoDoServico, paradasDoRoteiro, radioDoHorario, tabAte } from './suporte/publico';
import { semRolagemHorizontal } from './suporte/vitrine';

// Sem JS o axe não injeta (a análise depende de script na página): aqui só a rolagem; o axe das mesmas telas é
// conferido pelos specs com JS (publico-reserva-teclado.spec.ts).
const verificarTela = (page: Page, contexto: string) => semRolagemHorizontal(page, contexto);

// D-050 — spec do TESTER (independente da T-15). Cenário do usuário em /e2e-reservas-1 (nenhum outro spec usa este
// salão): Escova com Bia 09:00 e Hidratação com Cris 09:30 (ADJACENTES, de manhã, 2 profissionais) e Manicure com
// Duda 14:00 (à tarde, 3ª profissional). 375×812 com toque (projeto padrão), SÓ teclado E SEM JavaScript ao mesmo
// tempo; sem rolagem horizontal em cada tela. Confere no banco os 3 itens e a confirmação de WhatsApp pendente.

test.use({ javaScriptEnabled: false });

const SLUG = 'e2e-reservas-1';

async function escolher(page: Page, profissional: string, hora: string) {
  // Todas as grades do serviço partilham um name (critério 10): o Tab entra no grupo pelo 1º rádio da página e
  // as setas atravessam as grades até o horário do profissional.
  await tabAte(page, page.getByRole('radio').first());
  await marcarComSetas(page, radioDoHorario(page, profissional, hora));
  await tabAte(page, page.getByRole('button', { name: 'Continuar' }));
  await page.keyboard.press('Enter');
}

test('TESTER: exemplo do usuário só com teclado e sem JS em 375×812 (itens adjacentes de manhã + tarde)', async ({ page }) => {
  const telefone = telefoneUnico();
  const dia = diaFuturo({ de: 3, ate: 13 });
  expect(page.viewportSize()).toEqual({ width: 375, height: 812 });
  await page.goto(`/${SLUG}`);
  await verificarTela(page, 'perfil');

  for (const nome of ['Escova', 'Hidratação', 'Manicure']) {
    const caixa = page.getByRole('checkbox', { name: new RegExp(`^${nome}\\b`) });
    await tabAte(page, caixa);
    await page.keyboard.press('Space');
    await expect(caixa).toBeChecked();
  }
  await tabAte(page, page.getByRole('button', { name: 'Continuar' }));
  await page.keyboard.press('Enter');

  await expect(page.getByRole('heading', { level: 2, name: 'Escolha o dia' })).toBeVisible();
  await verificarTela(page, 'dia');
  await tabAte(page, linkDoDia(page, dia));
  await page.keyboard.press('Enter');

  await noPassoDoServico(page, 'Escova', 1, 3);
  await verificarTela(page, 'serviço 1');
  // Escova é feita por Ana e Bia: as duas aparecem (cada serviço com os SEUS profissionais).
  await expect(page.getByRole('group', { name: 'Horários de Ana', exact: true })).toBeVisible();
  await escolher(page, 'Bia', '09:00');

  await noPassoDoServico(page, 'Hidratação', 2, 3);
  await verificarTela(page, 'serviço 2');
  // Hidratação: Ana e Cris (nunca Bia). RN-10: nada que cruze a Escova [09:00, 09:30) para a cliente.
  await expect(page.getByRole('group', { name: 'Horários de Bia', exact: true })).toHaveCount(0);
  for (const p of ['Ana', 'Cris']) {
    for (const h of ['08:30', '08:45', '09:00', '09:15']) await expect(radioDoHorario(page, p, h)).toHaveCount(0);
    await expect(radioDoHorario(page, p, '09:30')).toHaveCount(1); // adjacente é permitido (RN-8 semiaberto)
  }
  await escolher(page, 'Cris', '09:30');

  await noPassoDoServico(page, 'Manicure', 3, 3);
  await verificarTela(page, 'serviço 3');
  await expect(page.getByRole('navigation', { name: 'Filtrar por profissional' })).toHaveCount(0);
  for (const h of ['09:00', '09:15', '09:30', '10:00']) await expect(radioDoHorario(page, 'Duda', h)).toHaveCount(0);
  await escolher(page, 'Duda', '14:00');

  await expect(page.getByRole('heading', { level: 2, name: 'Seus dados' })).toBeVisible();
  await verificarTela(page, 'dados');
  await tabAte(page, page.getByRole('textbox', { name: /Nome/ }));
  await page.keyboard.type('Tester Teclado');
  await tabAte(page, page.getByRole('textbox', { name: /Telefone/ }));
  await page.keyboard.type(telefone.digitado);
  const msg = page.getByRole('checkbox', { name: /mensagens da minha reserva/ });
  await tabAte(page, msg);
  await page.keyboard.press('Space');
  await expect(msg).toBeChecked();
  await tabAte(page, page.getByRole('button', { name: 'Confirmar reserva' }));
  const envio = page.waitForResponse((r) => r.request().method() === 'POST');
  await page.keyboard.press('Enter');
  expect((await envio).status()).toBe(200);

  await expect(page.getByText('Reserva confirmada!')).toBeVisible();
  expect(await paradasDoRoteiro(page)).toEqual([
    expect.stringMatching(/^09:00.*09:30 .*Escova .*com Bia/),
    expect.stringMatching(/^09:30.*10:15 .*Hidratação .*com Cris/),
    expect.stringMatching(/^14:00.*14:45 .*Manicure .*com Duda/),
  ]);
  await expect(page.getByText(/R\$\s*180,00/).first()).toBeVisible(); // 55 + 80 + 45
  await verificarTela(page, 'confirmação');
  expect(page.url()).not.toContain(telefone.digitado.replace(/\D/g, ''));

  const reservas = await reservasDoTelefone(SLUG, telefone.e164);
  expect(reservas).toHaveLength(1);
  expect(reservas[0]!.itens.map((i) => `${i.servico}/${i.profissional}/${i.status}`)).toEqual([
    'Escova/Bia/confirmado',
    'Hidratação/Cris/confirmado',
    'Manicure/Duda/confirmado',
  ]);
  // Exatamente 1 confirmação registrada (pendente: o E2E não tem worker), sem item.
  const mensagens = await comBanco((c) =>
    c.query<{ tipo: string; revisao: number; estado: string; item: string | null }>(
      `SELECT m.tipo::text, m.revisao, m.estado::text, m.reserva_item_id AS item
         FROM mensagem m JOIN reserva r ON r.id = m.reserva_id
         JOIN cliente cl ON cl.id = r.cliente_id
        WHERE cl.telefone_e164 = $1`,
      [telefone.e164],
    ),
  );
  expect(mensagens.rows).toEqual([{ tipo: 'confirmacao', revisao: 0, estado: 'pendente', item: null }]);
  console.log(`[TESTER] telefone=${telefone.e164} dia=${dia}`);
});
