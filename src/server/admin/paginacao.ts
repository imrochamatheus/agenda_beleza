// Paginação e leitura de parâmetros das listas globais do super admin (D-045 RN-13). Puro e client-safe.

export const POR_PAGINA_ADMIN = 20;
/** Teto do OFFSET (R-1): acima disso a página é tratada como 500. */
export const PAGINA_MAXIMA_ADMIN = 500;
/** Salões no `Select` de filtro; acima disso o filtro vira campo de código (injetável nos testes). */
export const LIMITE_SELECT_SALOES = 100;

export type Consulta = { [chave: string]: string | string[] | undefined };

/** Valor único de um parâmetro de consulta; lista ou ausente → undefined. */
export const unico = (v: string | string[] | undefined): string | undefined => (typeof v === 'string' ? v : undefined);

/** `^[1-9]\d{0,6}$`, senão 1; acima de 500 → 500. */
export function lerPaginaAdmin(v: unknown): number {
  if (typeof v !== 'string' || !/^[1-9]\d{0,6}$/.test(v)) return 1;
  return Math.min(Number(v), PAGINA_MAXIMA_ADMIN);
}

export const deslocamentoDaPagina = (pagina: number): number => (Math.max(1, Math.trunc(pagina)) - 1) * POR_PAGINA_ADMIN;

export const totalDePaginas = (total: number): number => Math.max(1, Math.ceil(total / POR_PAGINA_ADMIN));

export type OpcaoDeSalao = { id: string; nome: string };
/** Filtro de salão: `Select` com todos (até o limite) ou campo de código (UUID). */
export type FiltroDeSalao = { modo: 'select'; opcoes: readonly OpcaoDeSalao[] } | { modo: 'codigo' };
