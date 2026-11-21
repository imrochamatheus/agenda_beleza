import { type PortaTurnstile, type ResultadoTurnstile, TOKEN_TURNSTILE_SIMULADO, tokenTurnstileAceitavel } from './port';

// Turnstile simulado (RN-3, D-7). Aceita só o token fictício que a Cloudflare documenta para as
// chaves de teste, quantas vezes for apresentado (não é de uso único), e rejeita qualquer outro.
// Não acessa rede nem banco.

/** Token aceito pelo simulado (documentado no README; o widget simulado da E4.2 o entrega). */
export { TOKEN_TURNSTILE_SIMULADO };
/** Chave de site devolvida por `chaveDoSite()` no modo simulado (chave de teste da Cloudflare). */
export const CHAVE_SITE_TURNSTILE_SIMULADA = '1x00000000000000000000AA';

export function criarTurnstileSimulado(): PortaTurnstile {
  return {
    async validar({ token }): Promise<ResultadoTurnstile> {
      if (tokenTurnstileAceitavel(token) && token === TOKEN_TURNSTILE_SIMULADO) {
        return { valido: true };
      }
      return { valido: false, motivo: 'token_invalido' };
    },
    chaveDoSite() {
      return CHAVE_SITE_TURNSTILE_SIMULADA;
    },
  };
}
