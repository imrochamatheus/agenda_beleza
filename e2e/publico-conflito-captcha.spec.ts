import { expect, test, type Page } from '@playwright/test';

import { comBanco, contarReservas, ocuparHorario, reservasDoTelefone, telefoneUnico } from './suporte/fixtures';
import { semRolagemHorizontal } from './suporte/vitrine';
import {
  abrirSalao, confirmar, continuar, diaFuturo, escolherDia, escolherHorarioDe, escolherServicos, instanteDoValor,
  noPassoDoServico, paradasDoRoteiro, preencherDados, radioDoHorario, seletorDeCaptcha, verificarTela,
} from './suporte/publico';

// D-050 CA-10, CA-13 e critério visual 15 (D-036 CA-16/CA-17 revistos): o horário de UM item é tomado entre a
// escolha e o envio (com e sem JavaScript), a saída "Seguir sem X" quando o serviço fica sem horário, e o captcha
// inválido pelo widget simulado. Salões e dias isolados por teste.

const MS_HORA = 3_600_000;

async function clientesDoTelefone(slug: string, e164: string): Promise<number> {
  return comBanco(async (c) => {
    const r = await c.query(
      `SELECT count(*)::int AS n FROM cliente c JOIN salao_slug sl ON sl.salao_id = c.salao_id AND sl.slug = $1
        WHERE c.telefone_e164 = $2`,
      [slug, e164],
    );
    return r.rows[0].n as number;
  });
}

/** Do perfil ao passo de dados com Escova (Bia 09:00), Hidratação (Cris 10:00) e, se pedido, Manicure (Duda 15:00). */
async function ateOsDados(page: Page, slug: string, dia: string, comManicure: boolean) {
  await abrirSalao(page, slug);
  await escolherServicos(page, comManicure ? ['Escova', 'Hidratação', 'Manicure'] : ['Escova', 'Hidratação']);
  await continuar(page);
  await escolherDia(page, dia);
  const n = comManicure ? 3 : 2;
  await noPassoDoServico(page, 'Escova', 1, n);
  const escova = await escolherHorarioDe(page, 'Bia', '09:00');
  await continuar(page);
  await noPassoDoServico(page, 'Hidratação', 2, n);
  const hidratacao = await escolherHorarioDe(page, 'Cris', '10:00');
  await continuar(page);
  if (comManicure) {
    await noPassoDoServico(page, 'Manicure', 3, 3);
    await escolherHorarioDe(page, 'Duda', '15:00');
    await continuar(page);
  }
  return { escova: instanteDoValor(escova), hidratacao: instanteDoValor(hidratacao) };
}

/**
 * CA-10: outra cliente fica com o horário da Hidratação. A resposta (sem redirecionar, URL igual, também sem JS) diz
 * qual item caiu, mostra horários atualizados só para ele, mantém os outros e preserva nome, telefone e aceite;
 * nada é gravado (nem cliente). Reescolher outro horário confirma a reserva com os 3 itens.
 */
async function conflitoDeHorario(page: Page, slug: string, dia: string, comJs: boolean) {
  const telefone = telefoneUnico();
  const { hidratacao } = await ateOsDados(page, slug, dia, true);
  await preencherDados(page, { nome: 'Cliente Atrasada', telefone: telefone.digitado });
  const urlAntes = page.url();

  const antes = await contarReservas(slug);
  await ocuparHorario(slug, 'Cris', new Date(hidratacao), 45, 'Hidratação');
  expect(await contarReservas(slug)).toBe(antes + 1);
  const envio = page.waitForResponse((r) => r.request().method() === 'POST');
  await confirmar(page);
  expect((await envio).status()).toBe(200);

  await expect(page.getByRole('heading', { level: 2, name: 'Escolha outro horário para Hidratação' })).toBeVisible();
  await expect(page.getByText(/O horário das 10:00 de Hidratação com Cris acabou de ser reservado\./)).toBeVisible();
  expect(page.url()).toBe(urlAntes);
  expect(page.url()).not.toMatch(/Atrasada|nome=|telefone=/);
  await expect(page.getByRole('textbox', { name: /Nome/ })).toHaveValue('Cliente Atrasada');
  await expect(page.getByRole('textbox', { name: /Telefone/ })).toHaveValue(telefone.digitado);
  await expect(page.getByRole('checkbox', { name: /mensagens da minha reserva/ })).toBeChecked();
  // Os outros itens continuam no roteiro; só a Hidratação está aberta, com as grades atualizadas.
  const roteiro = await paradasDoRoteiro(page);
  expect(roteiro).toHaveLength(3);
  expect(roteiro[0]).toMatch(/^09:00 .*Escova .*com Bia/);
  expect(roteiro[1]).toMatch(/Hidratação .*escolha um novo horário abaixo/);
  expect(roteiro[2]).toMatch(/^15:00 .*Manicure .*com Duda/);
  await expect(page.getByRole('group', { name: /^Horários de / })).toHaveCount(2);
  await expect(radioDoHorario(page, 'Cris', '10:00')).toHaveCount(0);
  if (comJs) await verificarTela(page, 'reescolha');
  else await semRolagemHorizontal(page, 'reescolha sem JS');
  expect(await reservasDoTelefone(slug, telefone.e164)).toHaveLength(0);
  expect(await clientesDoTelefone(slug, telefone.e164)).toBe(0);
  expect(await contarReservas(slug)).toBe(antes + 1);

  // Reescolhe e confirma sem redigitar nada (o reenvio leva `reabrir`).
  const novo = await escolherHorarioDe(page, 'Cris', '11:00');
  await confirmar(page);
  await expect(page.getByText('Reserva confirmada!')).toBeVisible();
  const reservas = await reservasDoTelefone(slug, telefone.e164);
  expect(reservas).toHaveLength(1);
  expect(reservas[0]!.itens.map((i) => `${i.servico}/${i.profissional}`)).toEqual(['Escova/Bia', 'Hidratação/Cris', 'Manicure/Duda']);
  expect(reservas[0]!.itens[1]!.inicio.toISOString()).toBe(instanteDoValor(novo));
  expect(await contarReservas(slug)).toBe(antes + 2);
}

test('CA-10: horário de um item tomado antes do envio → reescolha só desse item, com os dados preservados', async ({ page }) => {
  await conflitoDeHorario(page, 'e2e-reservas-3', diaFuturo({ de: 2, ate: 13 }), true);
});

test.describe('sem JavaScript', () => {
  test.use({ javaScriptEnabled: false });
  test('CA-10/CA-13: o mesmo conflito, por POST sem JavaScript, preserva os dados e permite reescolher', async ({ page }) => {
    await conflitoDeHorario(page, 'e2e-reservas-6', diaFuturo({ de: 3, ate: 13 }), false);
  });
});

test('CA-10: sem horário restante para o item → "Seguir sem Hidratação" volta aos dados só com a Escova', async ({ page }) => {
  const slug = 'e2e-reservas-3';
  const telefone = telefoneUnico();
  const dia = diaFuturo({ de: 2, ate: 13, indice: 2 });
  const { escova } = await ateOsDados(page, slug, dia, false);
  await preencherDados(page, { nome: 'Cliente Sem Hidratação', telefone: telefone.digitado });

  // Ana e Cris (quem faz Hidratação) ficam ocupadas na jornada inteira do dia (08:00–12:00 e 13:00–20:00).
  const meiaNoite = new Date(escova).getTime() - 9 * MS_HORA;
  for (const nome of ['Ana', 'Cris']) {
    await ocuparHorario(slug, nome, new Date(meiaNoite + 8 * MS_HORA), 240, 'Hidratação');
    await ocuparHorario(slug, nome, new Date(meiaNoite + 13 * MS_HORA), 420, 'Hidratação');
  }
  await confirmar(page);

  await expect(page.getByRole('heading', { level: 3, name: 'Não há mais horários para Hidratação neste dia.' })).toBeVisible();
  await expect(page.getByRole('radio')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Escolher outro dia' })).toBeVisible();
  await verificarTela(page, 'reescolha sem horário');
  expect(await reservasDoTelefone(slug, telefone.e164)).toHaveLength(0);

  await page.getByRole('link', { name: 'Seguir sem Hidratação' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Seus dados' })).toBeVisible();
  expect(await paradasDoRoteiro(page)).toEqual([expect.stringMatching(/^09:00 .*Escova .*com Bia/)]);
  // GET: os dados pessoais não viajam na URL, então são digitados de novo (ND-1).
  await expect(page.getByRole('textbox', { name: /Nome/ })).toHaveValue('');
  await preencherDados(page, { nome: 'Cliente Sem Hidratação', telefone: telefone.digitado });
  await confirmar(page);
  await expect(page.getByText('Reserva confirmada!')).toBeVisible();
  const reservas = await reservasDoTelefone(slug, telefone.e164);
  expect(reservas).toHaveLength(1);
  expect(reservas[0]!.itens.map((i) => `${i.servico}/${i.profissional}`)).toEqual(['Escova/Bia']);
});

test('CA-17: token de captcha inválido → mensagem de captcha e nenhuma reserva', async ({ page }) => {
  const slug = 'e2e-reservas-4';
  const telefone = telefoneUnico();
  await abrirSalao(page, slug);
  await escolherServicos(page, ['Escova']);
  await continuar(page);
  await escolherDia(page, diaFuturo({ de: 1, ate: 13 }));
  await noPassoDoServico(page, 'Escova', 1, 1);
  await escolherHorarioDe(page, 'Ana', '09:00');
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
