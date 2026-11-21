// Porta do Cloudflare Turnstile (RN-10). Não importa provedor, Prisma nem process.env.

export type MotivoTurnstileInvalido = 'token_invalido' | 'indisponivel';

export type ResultadoTurnstile =
  | { valido: true }
  | { valido: false; motivo: MotivoTurnstileInvalido };

export type EntradaTurnstile = { token: string | null | undefined; ip?: string };

export interface PortaTurnstile {
  /** Nunca lança por causa do provedor: falhas viram `{ valido: false, motivo: 'indisponivel' }`. */
  validar(e: EntradaTurnstile): Promise<ResultadoTurnstile>;
  /** Chave pública do widget, lida a cada chamada (CA-14). */
  chaveDoSite(): string;
}

/** Tamanho máximo de token documentado pela Cloudflare. */
export const TAMANHO_MAXIMO_TOKEN = 2048;

/**
 * Verificação local, comum a simulado e real, feita antes de qualquer chamada de rede:
 * token ausente, vazio, só com espaços ou maior que TAMANHO_MAXIMO_TOKEN é `token_invalido`.
 */
export function tokenTurnstileAceitavel(token: string | null | undefined): token is string {
  return typeof token === 'string' && token.trim() !== '' && token.length <= TAMANHO_MAXIMO_TOKEN;
}

/** Token fictício documentado pela Cloudflare, aceito só pelo adaptador simulado (README). */
export const TOKEN_TURNSTILE_SIMULADO = 'XXXX.DUMMY.TOKEN.XXXX';

/** Script oficial do widget (carregado pelo navegador no modo real; D-027). */
export const URL_SCRIPT_TURNSTILE = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
