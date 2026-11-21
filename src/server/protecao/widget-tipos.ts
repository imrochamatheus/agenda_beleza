// Contrato client-safe do widget Turnstile (D-027). Só texto e booleanos.
export type DadosDoWidget = {
  modo: 'simulado' | 'real';
  /** Chave pública do site (modo real). */
  chaveDoSite: string;
  /** Token documentado do simulado, entregue como campo oculto (modo simulado). */
  tokenSimulado: string;
  /** Mostra um seletor para enviar um token inválido (só vitrine/dev, modo simulado). */
  controleDeTeste: boolean;
};

/** Valor do seletor de teste que o simulado recusa. */
export const TOKEN_INVALIDO_DE_TESTE = 'TOKEN.INVALIDO.DE.TESTE';
