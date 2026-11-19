import type { PapelDeSalao } from '@/server/tenant/context';

export const LAYOUTS_VITRINE = ['publico', 'publico-salao', 'painel', 'admin'] as const;
export type LayoutVitrine = (typeof LAYOUTS_VITRINE)[number];

const PAPEIS: readonly PapelDeSalao[] = ['gestor', 'profissional'];

export type OpcoesVitrine = { layout: LayoutVitrine; papel: PapelDeSalao; caminho?: string };

/** Só caminhos simples: o valor alimenta apenas o aria-current, nunca vira link nem texto. */
const CAMINHO_VALIDO = /^\/[a-z0-9/-]{0,120}$/;

function unico(valor: string | string[] | undefined): string | undefined {
  return typeof valor === 'string' ? valor : undefined;
}

/**
 * Lê ?layout, ?papel e ?caminho da vitrine (D-009 D-19). Desconhecido, ausente ou repetido
 * (array) → padrão ('publico', 'gestor', sem caminho), sem erro.
 */
export function lerOpcoesVitrine(busca: Record<string, string | string[] | undefined>): OpcoesVitrine {
  const layout = unico(busca.layout);
  const papel = unico(busca.papel);
  const caminho = unico(busca.caminho);
  return {
    layout: (LAYOUTS_VITRINE as readonly string[]).includes(layout ?? '') ? (layout as LayoutVitrine) : 'publico',
    papel: (PAPEIS as readonly string[]).includes(papel ?? '') ? (papel as PapelDeSalao) : 'gestor',
    ...(caminho !== undefined && CAMINHO_VALIDO.test(caminho) ? { caminho } : {}),
  };
}
