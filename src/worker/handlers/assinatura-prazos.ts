import { FILA } from '@/server/queue/filas';

import { definirHandler } from './tipos';

/**
 * Stub (D-5): prazos da assinatura (carência, suspensão). A E6.3 preenche a lógica idempotente e pode
 * mudar o cron neste arquivo. Não lê nem grava nenhuma tabela de `public` (RN-17).
 */
export const assinaturaPrazos = definirHandler(FILA.assinaturaPrazos, {
  cron: '*/5 * * * *',
  async processar() {},
});
