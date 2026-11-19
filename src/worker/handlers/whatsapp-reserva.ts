import { FILA } from '@/server/queue/filas';

import { definirHandler } from './tipos';

/**
 * Stub (D-5): envio das mensagens de reserva (confirmação, remarcação, cancelamento). A E7.1 preenche
 * o envio pelo adaptador e o registro de cada tentativa. O payload `{ mensagemId }` já chega validado.
 * Não lê nem grava `public` (RN-17).
 */
export const whatsappReserva = definirHandler(FILA.whatsappReserva, {
  async processar() {},
});
