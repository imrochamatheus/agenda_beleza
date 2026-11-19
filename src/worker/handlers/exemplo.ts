import { FILA } from '@/server/queue/filas';

import { definirHandler } from './tipos';

/**
 * Job de exemplo (D-4): espera `esperaMs` (0 a 60000; padrão 0) e conclui. Serve ao CA-1, ao CA-4 e à
 * verificação manual (`npm run fila:exemplo -- <ms>`). A espera é interrompida pelo `ctx.sinal`.
 */
export const exemplo = definirHandler(FILA.exemplo, {
  async processar({ esperaMs = 0 }, ctx) {
    ctx.log('worker.exemplo_iniciado', { id: ctx.id, esperaMs });
    await new Promise<void>((resolver, rejeitar) => {
      const interromper = () => {
        clearTimeout(temporizador);
        rejeitar(new Error('exemplo interrompido'));
      };
      const temporizador = setTimeout(() => {
        ctx.sinal.removeEventListener('abort', interromper);
        resolver();
      }, esperaMs);
      if (ctx.sinal.aborted) interromper();
      else ctx.sinal.addEventListener('abort', interromper, { once: true });
    });
  },
});
