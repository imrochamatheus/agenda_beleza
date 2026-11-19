import { FILA } from '@/server/queue/filas';

import { definirHandler } from './tipos';

/**
 * Stub (D-5): reconciliação das mensagens de WhatsApp (reenfileira o que não chegou à fila). A E7.1
 * preenche a lógica e pode mudar o cron neste arquivo. Não lê nem grava `public` (RN-17).
 */
export const reconciliarMensagens = definirHandler(FILA.reconciliarMensagens, {
  cron: '* * * * *',
  async processar() {},
});
