import type { Finalidade } from '@/config/termos';
import type { ErrosConsentimento, ValoresConsentimento } from '@/server/consentimento/tipos';

/** Estado do formulário da vitrine /dev/consentimento (D-023 §3.7). Sem 'use server'. */
export type EstadoConsentimento = {
  erros: ErrosConsentimento;
  valores: ValoresConsentimento;
  /** Finalidades que seriam gravadas; null enquanto não houve envio válido. */
  gravaria: Finalidade[] | null;
};

export function estadoConsentimentoInicial(): EstadoConsentimento {
  return { erros: {}, valores: { mensagensReserva: false, conviteAvaliacao: false }, gravaria: null };
}
