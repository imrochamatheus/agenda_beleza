import type { TipoMensagem } from './tipos';

/** Chave de idempotência e `singletonKey` do pg-boss: `<reservaId>:<tipo>:<revisao>` (RN-2). */
export function chaveDaMensagem(reservaId: string, tipo: TipoMensagem, revisao: number): string {
  if (!Number.isSafeInteger(revisao) || revisao < 0) {
    throw new RangeError('revisão da mensagem deve ser um inteiro não negativo');
  }
  return `${reservaId}:${tipo}:${revisao}`;
}
