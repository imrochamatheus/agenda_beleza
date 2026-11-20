import { SEGMENTOS_RESERVADOS } from '@/config/navegacao';

// Slug público do salão (D-011 §3.1; RN-8, RN-9, RN-10). Funções puras: a escolha do candidato
// livre recebe os slugs ocupados (lidos pelo repositório) e trata os segmentos reservados das
// rotas como colisão (fonte única: SEGMENTOS_RESERVADOS, sem cópia da lista).

/** Slug usado quando o nome não tem nenhum caractere aproveitável (RN-8, passo 6). */
export const SLUG_FALLBACK = 'salao';
/** Tamanho máximo do slug base, antes do sufixo numérico (RN-8, passo 5; D-13). */
export const SLUG_BASE_MAX = 50;
/** Mesmo padrão do CHECK salao_slug_formato_chk. */
export const FORMATO_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * RN-8: NFD sem diacríticos → minúsculas → cada sequência fora de [a-z0-9] vira '-' → apara hífens
 * → corta em 50 no último hífen anterior ao limite (se houver) e apara → vazio vira 'salao'.
 * O resultado sempre casa FORMATO_SLUG.
 */
export function slugBase(nome: string): string {
  let s = nome
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (s.length > SLUG_BASE_MAX) {
    const cortado = s.slice(0, SLUG_BASE_MAX);
    // Se o caractere seguinte ao corte é hífen, o corte já cai numa fronteira de palavra.
    const fronteira = s[SLUG_BASE_MAX] === '-' ? SLUG_BASE_MAX : cortado.lastIndexOf('-');
    s = (fronteira > 0 ? cortado.slice(0, fronteira) : cortado).replace(/-+$/g, '');
  }
  return s === '' ? SLUG_FALLBACK : s;
}

/**
 * RN-9/RN-10: primeiro de base, base-2, base-3… que não está em `reservados` nem em `ocupados`.
 * Lança Error se `base` não casar FORMATO_SLUG (erro de programação). Termina sempre: os conjuntos
 * são finitos. `reservados` só é informado pelos testes; produção usa SEGMENTOS_RESERVADOS.
 */
export function escolherSlugLivre(
  base: string,
  ocupados: ReadonlySet<string>,
  reservados: ReadonlySet<string> = SEGMENTOS_RESERVADOS,
): string {
  if (!FORMATO_SLUG.test(base)) {
    throw new Error('slug base fora do formato');
  }
  const livre = (c: string) => !reservados.has(c) && !ocupados.has(c);
  if (livre(base)) {
    return base;
  }
  for (let n = 2; ; n++) {
    const candidato = `${base}-${n}`;
    if (livre(candidato)) {
      return candidato;
    }
  }
}
