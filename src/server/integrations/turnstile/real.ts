import { type PortaTurnstile, type ResultadoTurnstile, tokenTurnstileAceitavel } from './port';

// Turnstile real: valida o token no `siteverify` da Cloudflare (RN-3, RN-10, D-007 §3.3).
// A URL é injetável (RN-6). A porta nunca lança por causa do provedor: qualquer falha vira
// `indisponivel`. Nada é registrado em log e o erro capturado é descartado (RN-7, RN-22).

export const URL_SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
/** Tempo-limite da chamada inteira, inclusive a leitura do corpo (D-11). */
export const TIMEOUT_TURNSTILE_MS = 5000;

export type OpcoesTurnstileReal = {
  segredo: string;
  /** Lida a cada chamada de `chaveDoSite()` (CA-14); o registro passa a leitura do ambiente. */
  lerChaveDoSite: () => string;
  urlSiteverify?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
};

const INDISPONIVEL: ResultadoTurnstile = { valido: false, motivo: 'indisponivel' };
const TOKEN_INVALIDO: ResultadoTurnstile = { valido: false, motivo: 'token_invalido' };

export function criarTurnstileReal(o: OpcoesTurnstileReal): PortaTurnstile {
  const url = o.urlSiteverify ?? URL_SITEVERIFY;
  const timeoutMs = o.timeoutMs ?? TIMEOUT_TURNSTILE_MS;
  const buscar = o.fetch ?? ((entrada, init) => fetch(entrada, init));

  return {
    async validar({ token, ip }): Promise<ResultadoTurnstile> {
      if (!tokenTurnstileAceitavel(token)) return TOKEN_INVALIDO;

      const corpo = new URLSearchParams({ secret: o.segredo, response: token });
      if (typeof ip === 'string' && ip !== '') corpo.set('remoteip', ip);

      try {
        const resposta = await buscar(url, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: corpo,
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!resposta.ok) return INDISPONIVEL;
        const json: unknown = await resposta.json();
        if (typeof json !== 'object' || json === null || !('success' in json)) return INDISPONIVEL;
        if (json.success === true) return { valido: true };
        if (json.success === false) return TOKEN_INVALIDO;
        return INDISPONIVEL;
      } catch {
        // Rede, tempo-limite (abort) ou corpo não JSON. O erro pode citar a requisição: descartado.
        return INDISPONIVEL;
      }
    },
    chaveDoSite() {
      return o.lerChaveDoSite();
    },
  };
}
