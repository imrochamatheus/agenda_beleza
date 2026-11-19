// Exigências de ambiente do Turnstile real (RN-13). Sem imports: este módulo entra no bundle do
// check-env.

export const SELETOR = 'TURNSTILE_ADAPTER';

/** Variáveis do provedor, declaradas no .env.example. Ignoradas no modo simulado. */
export const CHAVES = ['TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY'] as const;

/**
 * A chave do site NÃO entra: ela é lida a cada chamada de `chaveDoSite()` (CA-14).
 * Aqui só se exige que exista na inicialização.
 */
export type ConfigTurnstile = { segredo: string };
export type ConfigReal = ConfigTurnstile;

/** `fonte` já vem com string vazia convertida em ausente. Nunca devolve valores nos erros. */
export function lerConfigReal(
  fonte: Record<string, string | undefined>,
): { ok: true; config: ConfigTurnstile } | { ok: false; variaveis: string[] } {
  const variaveis = CHAVES.filter((chave) => fonte[chave] === undefined).sort();
  if (variaveis.length > 0) return { ok: false, variaveis };
  return { ok: true, config: { segredo: fonte.TURNSTILE_SECRET_KEY! } };
}
