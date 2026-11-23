// Passos da página pública real do salão (/<slug>), compartilhados pelos specs `publico-*` (D-036; D-050 T-15:
// cada serviço com profissional e horário próprios). Só por papel e nome acessível; esperas por estado
// (web-first), nunca por tempo.
import { expect, type Locator, type Page } from '@playwright/test';

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

/** "Continuar" ou "Continuar para seus dados" (o nome é comparado por substring). */
export async function continuar(page: Page) {
  await page.getByRole('button', { name: 'Continuar' }).click();
}

const DIAS_DA_SEMANA_SP = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'short' });
const DATA_SP = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' });

/**
 * Primeira data civil (AAAA-MM-DD, fuso de São Paulo) entre `de` e `ate` dias à frente cujo dia da semana está
 * em `semana` (0 = domingo) e que não está em `evitar` (deslocamentos em dias, ex.: dias com reservas do seed).
 * `indice` pula as primeiras datas elegíveis (testes do mesmo salão em dias distintos não disputam vaga).
 */
export function diaFuturo(o: { de: number; ate: number; semana?: readonly number[]; evitar?: readonly number[]; indice?: number }): string {
  const nomes = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  let restantes = o.indice ?? 0;
  for (let d = o.de; d <= o.ate; d += 1) {
    if (o.evitar?.includes(d)) continue;
    const instante = new Date(Date.now() + d * 86_400_000);
    if (o.semana && !o.semana.includes(nomes.indexOf(DIAS_DA_SEMANA_SP.format(instante)))) continue;
    if (restantes === 0) return DATA_SP.format(instante);
    restantes -= 1;
  }
  throw new Error('nenhum dia elegível no intervalo');
}

/** "AAAA-MM-DD" → "DD/MM/AAAA" (fim do nome acessível do link do dia). */
export const dataBr = (iso: string): string => iso.split('-').reverse().join('/');

/** Link de um dia do passo "Escolha o dia" (nome "Terça-feira, 25/11/2026"). */
export function linkDoDia(page: Page, iso: string): Locator {
  return page.getByRole('list').getByRole('link', { name: new RegExp(`${dataBr(iso).replace(/\//g, '\\/')}$`) });
}

/** Abre o dia `iso` (precisa estar na primeira página de dias e ter horários). */
export async function escolherDia(page: Page, iso: string) {
  await expect(page.getByRole('heading', { level: 2, name: 'Escolha o dia' })).toBeVisible();
  await linkDoDia(page, iso).click();
}

/** Confere que a tela é o passo "Serviço k de N" do serviço (h2 = nome, indicador no aria-describedby). */
export async function noPassoDoServico(page: Page, servico: string, k: number, n: number) {
  const h2 = page.getByRole('heading', { level: 2, name: servico, exact: true });
  await expect(h2).toBeVisible();
  await expect(h2).toHaveAccessibleDescription(`Serviço ${k} de ${n}`);
}

/** Rádio do horário `hora` (HH:MM) na grade do profissional. */
export function radioDoHorario(page: Page, profissional: string, hora: string): Locator {
  return page.getByRole('group', { name: `Horários de ${profissional}`, exact: true }).getByRole('radio', { name: hora, exact: true });
}

/** Marca o horário do profissional e devolve o valor do rádio (`<profissionalId>_<isoUTC>`). */
export async function escolherHorarioDe(page: Page, profissional: string, hora: string): Promise<string> {
  const radio = radioDoHorario(page, profissional, hora);
  await radio.check();
  return radio.inputValue();
}

/** Instante UTC (ISO) do valor de um item (`<profissionalId>_<isoUTC>`). */
export const instanteDoValor = (valor: string): string => valor.slice(valor.indexOf('_') + 1);

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

/** Textos das paradas do roteiro ("Seu dia"), na ordem do `<ol>`. */
export async function paradasDoRoteiro(page: Page): Promise<string[]> {
  const lista = page.getByRole('list', { name: 'Seu dia', exact: true });
  return (await lista.locator(':scope > li').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
}

/** Foco visível no elemento ativo (critério 6: contorno de `:focus-visible`). */
async function conferirFocoVisivel(page: Page) {
  const f = await page.evaluate(() => {
    const e = document.activeElement as HTMLElement | null;
    if (!e || e === document.body) return null;
    const s = getComputedStyle(e);
    return { descricao: `${e.tagName} ${(e.textContent ?? '').trim().slice(0, 40)}`, estilo: s.outlineStyle, largura: parseFloat(s.outlineWidth) };
  });
  if (f === null) return;
  expect(f.estilo, `foco visível em ${f.descricao}`).not.toBe('none');
  expect(f.largura, `contorno em ${f.descricao}`).toBeGreaterThan(0);
}

/** Tab até o elemento ganhar o foco, conferindo o foco visível em cada parada (só teclado). */
export async function tabAte(page: Page, alvo: Locator, limite = 150) {
  for (let i = 0; i < limite; i += 1) {
    await page.keyboard.press('Tab');
    await conferirFocoVisivel(page);
    if (await alvo.evaluate((e) => e === document.activeElement)) return;
  }
  throw new Error('elemento não alcançado por Tab');
}

/**
 * Com o foco num rádio do grupo (mesmo `name`), marca `alvo` só pelo teclado: Espaço marca o rádio focado e as
 * setas percorrem o grupo (inclusive entre as grades de profissionais, que partilham o `name`).
 */
export async function marcarComSetas(page: Page, alvo: Locator, limite = 300) {
  await page.keyboard.press('Space');
  for (let i = 0; i < limite && !(await alvo.isChecked()); i += 1) await page.keyboard.press('ArrowRight');
  await expect(alvo).toBeChecked();
  await expect(alvo).toBeFocused();
}
