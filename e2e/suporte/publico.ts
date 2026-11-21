// Passos da página pública real do salão (/<slug>), compartilhados pelos specs `publico-*` (D-036). Só por papel
// e nome acessível; esperas por estado (web-first), nunca por tempo.
import { expect, type Page } from '@playwright/test';

import { TOKEN_TURNSTILE_SIMULADO } from '@/server/integrations/turnstile/port';

import { analisarComAxe, semRolagemHorizontal } from './vitrine';

export { TOKEN_TURNSTILE_SIMULADO };

/** Sem rolagem horizontal e axe 4.14.0 sem violações na tela atual (CA-22). */
export async function verificarTela(page: Page, contexto: string) {
  await semRolagemHorizontal(page, contexto);
  await analisarComAxe(page, contexto);
}

export async function abrirSalao(page: Page, slug: string, busca = '') {
  const resposta = await page.goto(`/${slug}${busca}`);
  expect(resposta?.status(), `GET /${slug}`).toBe(200);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

export async function escolherServicos(page: Page, nomes: readonly string[]) {
  await expect(page.getByRole('heading', { level: 2, name: 'Serviços' })).toBeVisible();
  for (const nome of nomes) await page.getByRole('checkbox', { name: new RegExp(`^${nome}\\b`) }).check();
}

export async function continuar(page: Page) {
  await page.getByRole('button', { name: 'Continuar' }).click();
}

/** Nomes dos profissionais oferecidos no passo "Profissional" (sem "Sem preferência"). */
export async function profissionaisOferecidos(page: Page): Promise<string[]> {
  await expect(page.getByRole('heading', { level: 2, name: 'Profissional' })).toBeVisible();
  const rotulos = await page.getByRole('radio').evaluateAll((els) =>
    els.map((e) => (e.closest('label')?.textContent ?? '').trim()),
  );
  return rotulos.filter((t) => !t.startsWith('Sem preferência'));
}

export async function escolherProfissional(page: Page, nome: string | null) {
  await expect(page.getByRole('heading', { level: 2, name: 'Profissional' })).toBeVisible();
  await page.getByRole('radio', { name: nome === null ? /Sem preferência/ : new RegExp(`^${nome}$`) }).check();
}

/** Abre o dia de índice `indice` entre os que têm horários (dias distintos evitam disputar vaga). */
export async function escolherDia(page: Page, indice = 0) {
  await expect(page.getByRole('heading', { level: 2, name: 'Escolha o dia' })).toBeVisible();
  const dias = page.getByRole('list').getByRole('link', { name: /\d{2}\/\d{2}\/\d{4}$/ });
  await dias.nth(indice).click();
}

/** Marca o horário de índice `indice` e devolve o instante ISO (valor do rádio). */
export async function escolherHorario(page: Page, indice = 0): Promise<string> {
  await expect(page.getByRole('heading', { level: 2, name: 'Escolha o horário' })).toBeVisible();
  const radio = page.getByRole('radio').nth(indice);
  await radio.check();
  return radio.inputValue();
}

export async function preencherDados(page: Page, d: { nome: string; telefone: string; token?: 'valido' | 'invalido' }) {
  await expect(page.getByRole('heading', { level: 2, name: 'Seus dados' })).toBeVisible();
  await page.getByRole('textbox', { name: /Nome/ }).fill(d.nome);
  await page.getByRole('textbox', { name: /Telefone/ }).fill(d.telefone);
  await page.getByRole('checkbox', { name: /mensagens da minha reserva/ }).check();
  if (d.token === 'invalido') await seletorDeCaptcha(page).selectOption({ label: 'Token inválido' });
}

/** O widget simulado do formulário de reserva (os das denúncias ficam em outros ids). */
export const seletorDeCaptcha = (page: Page) => page.locator('#turnstile-simulado');

export async function confirmar(page: Page) {
  await page.getByRole('button', { name: 'Confirmar reserva' }).click();
}
