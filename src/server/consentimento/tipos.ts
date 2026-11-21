import type { Finalidade } from '@/config/termos';

/** Contratos client-safe do consentimento (D-023 §3.2): sem imports de servidor. */
export type OrigemConsentimento = 'publico' | 'equipe';

/** Nomes fixos dos campos do formulário (RN-18): definidos em src/config/termos.ts. */
export { CAMPOS_CONSENTIMENTO } from '@/config/termos';

export const MENSAGENS_CONSENTIMENTO = {
  mensagensReserva: 'Para reservar, aceite os Termos, a Política de Privacidade e o recebimento das mensagens da reserva.',
} as const;

export type ErrosConsentimento = { mensagensReserva?: string };

/** Estado marcado das caixas, para reexibir depois de um erro. */
export type ValoresConsentimento = { mensagensReserva: boolean; conviteAvaliacao: boolean };

export type ConsentimentoVisao = {
  id: string;
  finalidade: Finalidade;
  origem: OrigemConsentimento;
  versaoTermos: string;
  criadoEm: Date;
};

export type ResultadoConsentimentoDaReserva =
  | { ok: true; registrados: { id: string; finalidade: Finalidade }[] }
  | { ok: false; erros: ErrosConsentimento };
