// Normalização de texto livre digitado pela equipe (D-013 §3.3; extraído de auth/cadastro.ts, D-011
// RN-7, sem mudança de comportamento). Puro: usado no servidor pelos validadores.

const CONTROLE = /\p{Cc}/u;

/**
 * Trim + colapso de espaços internos repetidos. null se não for texto, tiver caractere de controle
 * (inclui quebra de linha e tabulação) ou, depois de normalizado, ficar fora de [min, max].
 */
export function normalizarNome(v: unknown, limite: { min: number; max: number }): string | null {
  if (typeof v !== 'string' || CONTROLE.test(v)) {
    return null;
  }
  const n = v.trim().replace(/\s+/gu, ' ');
  return n.length >= limite.min && n.length <= limite.max ? n : null;
}
