import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

// Auxiliares do E2E de acessibilidade (D-009 §3.11). Não é coletado (testMatch: **/*.spec.ts).

export const VARIANTES = [
  { nome: 'publico', busca: 'layout=publico', menu: 0 },
  { nome: 'publico-salao', busca: 'layout=publico-salao', menu: 0 },
  { nome: 'painel-gestor', busca: 'layout=painel&papel=gestor', menu: 7 },
  { nome: 'painel-profissional', busca: 'layout=painel&papel=profissional', menu: 2 },
  { nome: 'admin', busca: 'layout=admin', menu: 3 },
] as const;

/** Abre a vitrine; falha com mensagem clara se ela não responder 200 (CA-18, R-10). */
export async function abrirVitrine(page: Page, busca = '') {
  const resposta = await page.goto(`/dev/componentes${busca ? `?${busca}` : ''}`);
  const status = resposta?.status();
  if (status !== 200) {
    throw new Error(
      `A vitrine respondeu ${status}: ligue VITRINE_COMPONENTES=true no servidor ou libere a porta do E2E (E2E_PORT, padrão 3000) (reuseExistingServer).`,
    );
  }
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  return resposta!;
}

/** Sem rolagem horizontal do documento (RN-7). */
export async function semRolagemHorizontal(page: Page, contexto: string) {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const medidas = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    cliente: document.documentElement.clientWidth,
  }));
  expect(medidas.scroll, `rolagem horizontal em ${contexto}`).toBeLessThanOrEqual(medidas.cliente);
}

/** axe com as etiquetas WCAG 2.0/2.1 A e AA; zero violações, sem regra desligada (RN-23). */
export async function analisarComAxe(page: Page, contexto: string) {
  const resultado = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const resumo = resultado.violations.map((v) => ({
    id: v.id,
    impacto: v.impact,
    alvos: v.nodes.map((n) => n.target.join(' ')),
  }));
  expect(resumo, `violações do axe em ${contexto}`).toEqual([]);
}

export type Parada = { chave: string; outlineStyle: string; outlineWidth: number; tag: string };

/**
 * Marca os interativos esperados (visíveis, habilitados; um por grupo de rádios) com
 * data-e2e-chave e devolve as chaves (CA-14).
 */
export async function marcarInterativos(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const visivel = (e: Element) => {
      const r = e.getBoundingClientRect();
      const s = getComputedStyle(e);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && !e.closest('dialog:not([open])');
    };
    const chaves: string[] = [];
    const grupos = new Set<string>();
    const seletor =
      'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]';
    document.querySelectorAll<HTMLElement>(seletor).forEach((e, i) => {
      if (!visivel(e) || e.matches(':disabled')) return;
      if (e instanceof HTMLInputElement && e.type === 'radio') {
        const chave = `radio:${e.name}`;
        e.dataset.e2eChave = chave;
        if (!grupos.has(chave)) {
          grupos.add(chave);
          chaves.push(chave);
        }
        return;
      }
      const chave = `e${i}`;
      e.dataset.e2eChave = chave;
      chaves.push(chave);
    });
    return chaves;
  });
}

/**
 * Percorre a página com Tab, coletando cada elemento focado, até voltar ao primeiro (dá a volta
 * pelo fim do documento: o ponto de partida do Tab pode estar no meio da página).
 */
export async function percorrerComTab(page: Page, limite = 250): Promise<Parada[]> {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    window.scrollTo(0, 0);
  });
  const paradas: Parada[] = [];
  let primeira: string | null = null;
  for (let i = 0; i < limite; i += 1) {
    await page.keyboard.press('Tab');
    const parada = await page.evaluate(() => {
      const e = document.activeElement as HTMLElement | null;
      if (!e || e === document.body) return null;
      const s = getComputedStyle(e);
      return {
        chave: e.dataset.e2eChave ?? `${e.tagName.toLowerCase()}#${e.id}`,
        outlineStyle: s.outlineStyle,
        outlineWidth: parseFloat(s.outlineWidth),
        tag: e.tagName,
      };
    });
    // Fim do documento (foco na interface do navegador): o próximo Tab volta ao início.
    if (!parada) continue;
    if (parada.chave === primeira) break;
    primeira ??= parada.chave;
    // O date input tem vários segmentos internos: conta uma vez.
    if (paradas.at(-1)?.chave !== parada.chave) paradas.push(parada);
  }
  return paradas;
}

/** Tab até o elemento com o nome acessível pedido; devolve quantas teclas foram precisas. */
export async function tabAte(page: Page, alvo: (e: { texto: string; tag: string }) => boolean, limite = 250) {
  for (let i = 0; i < limite; i += 1) {
    await page.keyboard.press('Tab');
    const atual = await page.evaluate(() => ({
      texto: (document.activeElement?.textContent ?? '').trim(),
      tag: document.activeElement?.tagName ?? '',
    }));
    if (alvo(atual)) return i + 1;
  }
  throw new Error('elemento não alcançado por Tab');
}
