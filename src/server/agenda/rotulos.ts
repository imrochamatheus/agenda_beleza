import type { OrigemAgenda, StatusAgenda, TotalDoDetalhe } from './tipos';

// Rótulos textuais (RN-5): o status nunca depende só da cor.
/** Status da RESERVA (derivado): feminino, concorda com "reserva". */
export const ROTULO_STATUS: Readonly<Record<StatusAgenda, string>> = Object.freeze({
  confirmado: 'Confirmada',
  cancelado: 'Cancelada',
  concluido: 'Concluída',
  nao_compareceu: 'Não compareceu',
});

/** D-050 web-design §4.5: status do ITEM, masculino (concorda com "serviço"). */
export const ROTULO_STATUS_DO_ITEM: Readonly<Record<StatusAgenda, string>> = Object.freeze({
  confirmado: 'Confirmado',
  cancelado: 'Cancelado',
  concluido: 'Concluído',
  nao_compareceu: 'Não compareceu',
});

export const ROTULO_ORIGEM: Readonly<Record<OrigemAgenda, string>> = Object.freeze({
  publico: 'Reserva online',
  equipe: 'Cadastrada pela equipe',
});

/** D-050 web-design §5.10 / RN-35: rótulo do total do detalhe. */
export const ROTULO_TOTAL: Readonly<Record<TotalDoDetalhe['rotulo'], string>> = Object.freeze({
  reserva: 'Total',
  seus_servicos: 'Total dos seus serviços',
  cancelada: 'Total (cancelada)',
});

export function rotuloDoStatus(status: string): string {
  return Object.hasOwn(ROTULO_STATUS, status) ? ROTULO_STATUS[status as StatusAgenda] : status;
}

export function rotuloDoStatusDoItem(status: string): string {
  return Object.hasOwn(ROTULO_STATUS_DO_ITEM, status) ? ROTULO_STATUS_DO_ITEM[status as StatusAgenda] : status;
}

export function rotuloDaOrigem(origem: string): string {
  return Object.hasOwn(ROTULO_ORIGEM, origem) ? ROTULO_ORIGEM[origem as OrigemAgenda] : origem;
}
