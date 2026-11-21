// Contratos client-safe da proteção da página pública (D-027). Sem imports de servidor.

export const ESCOPOS_IP = ['reserva', 'disponibilidade', 'avaliacao', 'denuncia'] as const;
export type EscopoIp = (typeof ESCOPOS_IP)[number];

/** Máximo de reservas futuras confirmadas por número e salão (PLAN, S7). Constante, não env. */
export const MAXIMO_FUTURAS_POR_NUMERO = 3;

export const IP_DESCONHECIDO = 'desconhecido';

export type ResultadoLimite = { permitido: true } | { permitido: false; reiniciaEm: Date };

export const MENSAGENS_PROTECAO = {
  limitado: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.',
  futuras: 'Não foi possível concluir o agendamento com este número. Fale com o salão.',
  humano: 'Não foi possível confirmar que você é uma pessoa. Tente novamente.',
} as const;
