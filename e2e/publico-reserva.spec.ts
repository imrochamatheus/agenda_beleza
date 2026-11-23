import { expect, test, type Page } from '@playwright/test';

import { comBanco, reservasDoTelefone, telefoneUnico } from './suporte/fixtures';
import { semRolagemHorizontal } from './suporte/vitrine';
import {
  abrirSalao, confirmar, continuar, diaFuturo, escolherDia, escolherHorarioDe, escolherServicos, instanteDoValor,
  noPassoDoServico, paradasDoRoteiro, preencherDados, radioDoHorario, verificarTela,
} from './suporte/publico';

// D-050 CA-6, CA-9, CA-13 e CA-51 (D-036 CA-14/CA-22 revistos): cada serviço com o seu profissional e o seu horário,
// na página pública REAL, com o Turnstile simulado válido. /studio-aurora (salão A semeado): Escova (Helena, Marcos),
// Manicure e Hidratação (Helena, Beatriz); Marcos trabalha de terça a sábado e Beatriz de segunda a sexta, então
// os dias são de terça a sexta, a partir de 6 dias (a reserva r9 do seed fica daqui a 2 dias; b1 e b2 nos dias 8 e 12).
// Só este arquivo reserva no salão A; o cenário sem JavaScript usa /e2e-reservas-7.

const SEMANA_UTIL = [2, 3, 4, 5];
const EVITAR = [8, 12];

test('CA-6/CA-51: 3 serviços com 3 profissionais, manhã e tarde → 1 reserva com 3 itens e confirmação em ordem de início', async ({ page }) => {
  const telefone = telefoneUnico();
  const dia = diaFuturo({ de: 6, ate: 13, semana: SEMANA_UTIL, evitar: EVITAR });
  await abrirSalao(page, 'studio-aurora');
  await expect(page.getByRole('heading', { level: 1, name: 'Studio Aurora' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Avaliações' })).toBeVisible();
  await verificarTela(page, 'perfil e serviços');

  // A ordem de `s` é a do catálogo (Escova, Hidratação, Manicure); os horários escolhidos NÃO seguem essa ordem.
  await escolherServicos(page, ['Escova', 'Hidratação', 'Manicure']);
  await continuar(page);
  await verificarTela(page, 'passo dia');
  await escolherDia(page, dia);

  await noPassoDoServico(page, 'Escova', 1, 3);
  await verificarTela(page, 'serviço 1');
  const escova = await escolherHorarioDe(page, 'Marcos Pires', '11:00');
  await continuar(page);

  await noPassoDoServico(page, 'Hidratação', 2, 3);
  await verificarTela(page, 'serviço 2');
  const hidratacao = await escolherHorarioDe(page, 'Beatriz Lima', '10:00');
  await continuar(page);

  await noPassoDoServico(page, 'Manicure', 3, 3);
  await verificarTela(page, 'serviço 3');
  const manicure = await escolherHorarioDe(page, 'Helena Moura', '15:00');
  await page.getByRole('button', { name: 'Continuar para seus dados' }).click();

  await preencherDados(page, { nome: 'Maria Teste E2E', telefone: telefone.digitado });
  // Roteiro por horário (não pela ordem de escolha), com total e sem duração total (critérios 12 e 13).
  const roteiro = await paradasDoRoteiro(page);
  expect(roteiro).toHaveLength(3);
  expect(roteiro[0]).toMatch(/^10:00 .*Hidratação .*com Beatriz Lima/);
  expect(roteiro[1]).toMatch(/^11:00 .*Escova .*com Marcos Pires/);
  expect(roteiro[2]).toMatch(/^15:00 .*Manicure .*com Helena Moura/);
  await expect(page.getByText('Total', { exact: true })).toBeVisible();
  await expect(page.getByText('R$ 180,00', { exact: true })).toBeVisible();
  await verificarTela(page, 'passo dados');
  await confirmar(page);

  const sua = page.getByRole('region', { name: 'Sua reserva' });
  await expect(sua.getByText('Reserva confirmada!')).toBeVisible();
  const confirmacao = await paradasDoRoteiro(page);
  expect(confirmacao).toHaveLength(3);
  expect(confirmacao[0]).toMatch(/^10:00.*10:45 .*Hidratação .*com Beatriz Lima · R\$ 80,00/);
  expect(confirmacao[1]).toMatch(/^11:00.*11:30 .*Escova .*com Marcos Pires · R\$ 55,00/);
  expect(confirmacao[2]).toMatch(/^15:00.*15:45 .*Manicure .*com Helena Moura · R\$ 45,00/);
  await expect(sua.getByText('R$ 180,00', { exact: true })).toBeVisible();
  await expect(sua.getByText('3 serviços')).toBeVisible();
  // Intervalo ≥ 30 min entre paradas: o lembrete de que dá para sair do salão (ND-4).
  await expect(sua.getByText(/Entre um serviço e outro você pode sair do salão/)).toBeVisible();
  await verificarTela(page, 'confirmação');

  const reservas = await reservasDoTelefone('studio-aurora', telefone.e164);
  expect(reservas).toHaveLength(1);
  const [r] = reservas;
  expect(r!.status).toBe('confirmado');
  expect(r!.itens.map(({ servico, profissional, status, precoCentavos, duracaoMin }) => ({ servico, profissional, status, precoCentavos, duracaoMin }))).toEqual([
    { servico: 'Hidratação', profissional: 'Beatriz Lima', status: 'confirmado', precoCentavos: 8000, duracaoMin: 45 },
    { servico: 'Escova', profissional: 'Marcos Pires', status: 'confirmado', precoCentavos: 5500, duracaoMin: 30 },
    { servico: 'Manicure', profissional: 'Helena Moura', status: 'confirmado', precoCentavos: 4500, duracaoMin: 45 },
  ]);
  const inicios = [hidratacao, escova, manicure].map(instanteDoValor);
  expect(r!.itens.map((i) => i.inicio.toISOString())).toEqual(inicios);
  for (const i of r!.itens) expect(i.fim.getTime() - i.inicio.getTime()).toBe(i.duracaoMin * 60_000);
  expect(new Set(r!.itens.map((i) => i.ordem))).toEqual(new Set([0, 1, 2]));
  // Derivados da reserva: do primeiro início ao último fim.
  expect(r!.inicio.toISOString()).toBe(inicios[0]);
  expect(r!.fim.toISOString()).toBe(r!.itens[2]!.fim.toISOString());
});

test('CA-9: cada serviço oferece os SEUS profissionais; os horários descontam os itens escolhidos; "Alterar" preserva o resto', async ({ page }) => {
  const dia = diaFuturo({ de: 6, ate: 13, semana: SEMANA_UTIL, evitar: EVITAR, indice: 1 });
  await abrirSalao(page, 'studio-aurora');
  await escolherServicos(page, ['Escova', 'Manicure']);
  await continuar(page);
  await escolherDia(page, dia);

  // Escova: Helena e Marcos; filtro com o atual em aria-current (critério 10); sem "Sem preferência" (critério 8).
  await noPassoDoServico(page, 'Escova', 1, 2);
  await expect(page.getByRole('group', { name: /^Horários de / })).toHaveCount(2);
  await expect(page.getByRole('group', { name: 'Horários de Helena Moura' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Horários de Marcos Pires' })).toBeVisible();
  const filtro = page.getByRole('navigation', { name: 'Filtrar por profissional' });
  await expect(filtro.getByRole('link', { name: 'Todos (2)' })).toHaveAttribute('aria-current', 'true');
  await filtro.getByRole('link', { name: 'Marcos Pires' }).click();
  await expect(filtro.getByRole('link', { name: 'Marcos Pires' })).toHaveAttribute('aria-current', 'true');
  await expect(page.getByRole('group', { name: /^Horários de / })).toHaveCount(1);
  await escolherHorarioDe(page, 'Marcos Pires', '10:00');
  await continuar(page);

  // Manicure: Beatriz e Helena (Marcos não faz). A Helena tem 09:00, mas não 09:30/10:00: cruzariam a Escova (CA-4).
  await noPassoDoServico(page, 'Manicure', 2, 2);
  await expect(page.getByRole('group', { name: /^Horários de / })).toHaveCount(2);
  await expect(page.getByRole('group', { name: 'Horários de Beatriz Lima' })).toBeVisible();
  await expect(radioDoHorario(page, 'Helena Moura', '09:00')).toHaveCount(1);
  await expect(radioDoHorario(page, 'Helena Moura', '09:30')).toHaveCount(0);
  await expect(radioDoHorario(page, 'Helena Moura', '10:00')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Alterar Escova (10:00 com Marcos Pires)' })).toBeVisible();
  await escolherHorarioDe(page, 'Helena Moura', '15:00');
  await continuar(page);

  await expect(page.getByRole('heading', { level: 2, name: 'Seus dados' })).toBeVisible();
  const alterar = page.getByRole('link', { name: /^Alterar / });
  await expect(alterar).toHaveText(['Alterar Escova (10:00 com Marcos Pires)', 'Alterar Manicure (15:00 com Helena Moura)', 'Alterar serviços'], { useInnerText: false });
  await expect(page.getByText('R$ 100,00', { exact: true })).toBeVisible();
  for (const proibido of ['Sem preferência', 'com o mesmo profissional', 'Alterar profissional']) {
    await expect(page.getByText(proibido)).toHaveCount(0);
  }

  // "Alterar" da Manicure: volta ao passo dela com o horário atual pré-selecionado e a Escova preservada.
  await page.getByRole('link', { name: 'Alterar Manicure (15:00 com Helena Moura)' }).click();
  await noPassoDoServico(page, 'Manicure', 2, 2);
  await expect(page.getByText('alterando')).toBeVisible();
  await expect(radioDoHorario(page, 'Helena Moura', '15:00')).toBeChecked();
  await escolherHorarioDe(page, 'Beatriz Lima', '14:00');
  await continuar(page);
  await expect(page.getByRole('heading', { level: 2, name: 'Seus dados' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Alterar Escova (10:00 com Marcos Pires)' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Alterar Manicure (14:00 com Beatriz Lima)' })).toBeVisible();
  await verificarTela(page, 'dados depois de alterar');
});

test.describe('sem JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  async function passo(page: Page, contexto: string) {
    await semRolagemHorizontal(page, `${contexto} sem JS`);
  }

  test('CA-13: o cenário do exemplo, só por GET e um POST, cria a reserva com 3 itens', async ({ page }) => {
    const slug = 'e2e-reservas-7';
    const telefone = telefoneUnico();
    const dia = diaFuturo({ de: 2, ate: 13 });
    await abrirSalao(page, slug);
    await escolherServicos(page, ['Escova', 'Hidratação', 'Manicure']);
    await continuar(page);
    await passo(page, 'dia');
    await escolherDia(page, dia);
    await noPassoDoServico(page, 'Escova', 1, 3);
    await passo(page, 'serviço 1');
    await escolherHorarioDe(page, 'Bia', '09:00');
    await continuar(page);
    await noPassoDoServico(page, 'Hidratação', 2, 3);
    await escolherHorarioDe(page, 'Cris', '10:00');
    await continuar(page);
    await noPassoDoServico(page, 'Manicure', 3, 3);
    await escolherHorarioDe(page, 'Duda', '15:00');
    await continuar(page);
    await preencherDados(page, { nome: 'Sem Script', telefone: telefone.digitado });
    await passo(page, 'dados');
    const envio = page.waitForResponse((r) => r.request().method() === 'POST');
    await confirmar(page);
    expect((await envio).status()).toBe(200);
    await expect(page.getByText('Reserva confirmada!')).toBeVisible();
    expect(await paradasDoRoteiro(page)).toEqual([
      expect.stringMatching(/^09:00.*09:30 .*Escova .*com Bia/),
      expect.stringMatching(/^10:00.*10:45 .*Hidratação .*com Cris/),
      expect.stringMatching(/^15:00.*15:45 .*Manicure .*com Duda/),
    ]);
    await passo(page, 'confirmação');

    const reservas = await reservasDoTelefone(slug, telefone.e164);
    expect(reservas).toHaveLength(1);
    expect(reservas[0]!.itens.map((i) => `${i.servico}/${i.profissional}/${i.status}`)).toEqual([
      'Escova/Bia/confirmado',
      'Hidratação/Cris/confirmado',
      'Manicure/Duda/confirmado',
    ]);
  });

  test('slug histórico: 308 para o slug atual com a query do passo intacta; o fluxo segue de onde estava', async ({ page }) => {
    const slug = 'e2e-reservas-7';
    const antigo = `${slug}-antigo`;
    await comBanco((c) =>
      c.query(`INSERT INTO salao_slug (slug, salao_id, atual) SELECT $2, salao_id, false FROM salao_slug WHERE slug = $1 ON CONFLICT (slug) DO NOTHING`, [slug, antigo]),
    );
    await abrirSalao(page, slug);
    await escolherServicos(page, ['Escova', 'Hidratação']);
    await continuar(page);
    await escolherDia(page, diaFuturo({ de: 2, ate: 13, indice: 1 }));
    await escolherHorarioDe(page, 'Ana', '09:00');
    await continuar(page);
    await noPassoDoServico(page, 'Hidratação', 2, 2);
    const atual = new URL(page.url());

    const resposta = await page.request.get(`/${antigo}${atual.search}`, { maxRedirects: 0 });
    expect(resposta.status()).toBe(308);
    expect(resposta.headers().location).toBe(`/${slug}${atual.search}`);
    await page.goto(`/${antigo}${atual.search}`);
    expect(new URL(page.url()).pathname).toBe(`/${slug}`);
    await noPassoDoServico(page, 'Hidratação', 2, 2);
    await expect(page.getByRole('link', { name: 'Alterar Escova (09:00 com Ana)' })).toBeVisible();
  });
});
