import type { OrigemAgenda, StatusAgenda } from './tipos';

// Rótulos textuais (RN-5): o status nunca depende só da cor.
export const ROTULO_STATUS: Readonly<Record<StatusAgenda, string>> = Object.freeze({
  confirmado: 'Confirmada',
  cancelado: 'Cancelada',
  concluido: 'Concluída',
  nao_compareceu: 'Não compareceu',
});

export const ROTULO_ORIGEM: Readonly<Record<OrigemAgenda, string>> = Object.freeze({
  publico: 'Reserva online',
  equipe: 'Cadastrada pela equipe',
});

export function rotuloDoStatus(status: string): string {
  return Object.hasOwn(ROTULO_STATUS, status) ? ROTULO_STATUS[status as StatusAgenda] : status;
}

export function rotuloDaOrigem(origem: string): string {
  return Object.hasOwn(ROTULO_ORIGEM, origem) ? ROTULO_ORIGEM[origem as OrigemAgenda] : origem;
}
