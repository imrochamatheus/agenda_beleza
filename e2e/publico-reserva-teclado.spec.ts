import { expect, test, type Page } from '@playwright/test';

import { reservasDoTelefone, telefoneUnico } from './suporte/fixtures';
import {
  diaFuturo, linkDoDia, marcarComSetas, noPassoDoServico, paradasDoRoteiro, radioDoHorario, tabAte, verificarTela,
} from './suporte/publico';

// D-050 CA-12 e critérios visuais 6, 14 e 16 (D-036 CA-19/CA-22 revistos): o cenário do exemplo (Escova com Bia de
// manhã, Hidratação com Cris de manhã e Manicure com Duda à tarde) SÓ com o teclado (Tab, Espaço, Enter, setas), na
// página pública real (/e2e-reservas-2), 375×812 (isMobile, hasTouch). Cada tela: sem rolagem horizontal e axe
// sem violações; cada parada de Tab com foco visível.

/** Descrição curta do elemento focado, para conferir a ordem de Tab. */
const focado = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const e = document.activeElement as HTMLElement;
    if (e.tagName === 'A') return `link:${(e.textContent ?? '').replace(/\s+/g, ' ').trim()}`;
    if (e.tagName === 'INPUT') return `${(e as HTMLInputElement).type}:${(e as HTMLInputElement).name}`;
    if (e.tagName === 'SELECT') return `select:${e.id}`;
    return `${e.tagName.toLowerCase()}:${(e.textContent ?? '').trim()}`;
  });

/** Escolhe o horário do profissional usando o filtro (Tab + Enter no link) e as setas na grade. */
async function escolherPeloTeclado(page: Page, profissional: string, hora: string, comFiltro: boolean) {
  if (comFiltro) {
    const link = page.getByRole('navigation', { name: 'Filtrar por profissional' }).getByRole('link', { name: profissional, exact: true });
    await tabAte(page, link);
    await page.keyboard.press('Enter');
    await expect(link).toHaveAttribute('aria-current', 'true');
  }
  const grupo = page.getByRole('group', { name: `Horários de ${profissional}`, exact: true });
  await tabAte(page, grupo.getByRole('radio').first());
  await marcarComSetas(page, radioDoHorario(page, profissional, hora));
  await tabAte(page, page.getByRole('button', { name: 'Continuar' }));
  await page.keyboard.press('Enter');
}

test('CA-12: o exemplo de 3 serviços em 3 profissionais, manhã e tarde, só com o teclado', async ({ page }) => {
  const slug = 'e2e-reservas-2';
  const telefone = telefoneUnico();
  const dia = diaFuturo({ de: 3, ate: 13 });
  await page.goto(`/${slug}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Salão E2E 2' })).toBeVisible();
  await verificarTela(page, 'perfil');

  // 1. Serviços: Tab até cada checkbox, Espaço marca; Tab até "Continuar", Enter envia o GET.
  for (const nome of ['Escova', 'Hidratação', 'Manicure']) {
    const caixa = page.getByRole('checkbox', { name: new RegExp(`^${nome}\\b`) });
    await tabAte(page, caixa);
    await page.keyboard.press('Space');
    await expect(caixa).toBeChecked();
  }
  await tabAte(page, page.getByRole('button', { name: 'Continuar' }));
  await page.keyboard.press('Enter');

  // 2. Dia: Tab até o link do dia, Enter.
  await expect(page.getByRole('heading', { level: 2, name: 'Escolha o dia' })).toBeVisible();
  await verificarTela(page, 'passo dia');
  await tabAte(page, linkDoDia(page, dia));
  await page.keyboard.press('Enter');

  // 3. Um passo por serviço; com 2+ profissionais o filtro é um link (Tab + Enter).
  await noPassoDoServico(page, 'Escova', 1, 3);
  await verificarTela(page, 'serviço 1');
  await escolherPeloTeclado(page, 'Bia', '09:00', true);
  await noPassoDoServico(page, 'Hidratação', 2, 3);
  await verificarTela(page, 'serviço 2');
  await escolherPeloTeclado(page, 'Cris', '10:00', true);
  await noPassoDoServico(page, 'Manicure', 3, 3);
  await verificarTela(page, 'serviço 3');
  await expect(page.getByRole('navigation', { name: 'Filtrar por profissional' })).toHaveCount(0);
  await escolherPeloTeclado(page, 'Duda', '15:00', false);

  // 4. Dados: a ordem de Tab é "Alterar" (por horário) → "Alterar serviços" → Nome → Telefone → consentimentos →
  // verificação → "Confirmar reserva" (critério 14). Digita e marca nas paradas, sem clicar.
  await expect(page.getByRole('heading', { level: 2, name: 'Seus dados' })).toBeVisible();
  await verificarTela(page, 'passo dados');
  await tabAte(page, page.getByRole('link', { name: 'Alterar Escova (09:00 com Bia)' }));
  const ordem: string[] = [await focado(page)];
  for (let i = 0; i < 40 && ordem.at(-1) !== 'button:Confirmar reserva'; i += 1) {
    await page.keyboard.press('Tab');
    const atual = await focado(page);
    ordem.push(atual);
    if (atual === 'text:nome') await page.keyboard.type('Teclado Teste');
    if (atual === 'tel:telefone') await page.keyboard.type(telefone.digitado);
    if (atual === 'checkbox:consentimento_mensagens') await page.keyboard.press('Space');
  }
  const esperada = [
    'link:Alterar Escova (09:00 com Bia)',
    'link:Alterar Hidratação (10:00 com Cris)',
    'link:Alterar Manicure (15:00 com Duda)',
    'link:Alterar serviços',
    'text:nome',
    'tel:telefone',
  ];
  expect(ordem.slice(0, esperada.length)).toEqual(esperada);
  const caixas = ordem.filter((o) => o.startsWith('checkbox:'));
  expect(caixas).toEqual(['checkbox:consentimento_mensagens', 'checkbox:consentimento_convite']);
  expect(ordem.indexOf(caixas[0]!)).toBeGreaterThan(ordem.indexOf('tel:telefone'));
  expect(ordem.findIndex((o) => o.startsWith('select:'))).toBeGreaterThan(ordem.indexOf(caixas.at(-1)!));
  expect(ordem.at(-1)).toBe('button:Confirmar reserva');
  await expect(page.getByRole('checkbox', { name: /mensagens da minha reserva/ })).toBeChecked();
  await page.keyboard.press('Enter');

  await expect(page.getByText('Reserva confirmada!')).toBeVisible();
  expect(await paradasDoRoteiro(page)).toHaveLength(3);
  await verificarTela(page, 'confirmação');
  const reservas = await reservasDoTelefone(slug, telefone.e164);
  expect(reservas).toHaveLength(1);
  expect(reservas[0]!.status).toBe('confirmado');
  expect(reservas[0]!.itens.map((i) => `${i.servico}/${i.profissional}`)).toEqual(['Escova/Bia', 'Hidratação/Cris', 'Manicure/Duda']);
});
