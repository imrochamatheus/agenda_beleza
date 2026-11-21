import { processarPrazos } from '@/server/assinatura/prazos';
import type { ResumoPrazos } from '@/server/assinatura/prazos';
import { FILA } from '@/server/queue/filas';

import { definirHandler } from './tipos';

export type DependenciasAssinaturaPrazos = {
  agora?: () => Date;
  processar?: (agora: Date, log: (evento: string, campos: Record<string, unknown>) => void) => Promise<ResumoPrazos>;
};

/**
 * Prazos da assinatura (D-037): carência, suspensão, fim do teste e fim do acesso cancelado, pelo
 * mesmo ponto único dos eventos. Cron de 5 min, payload vazio; o relógio entra só aqui.
 */
export function criarAssinaturaPrazos(deps: DependenciasAssinaturaPrazos = {}) {
  return definirHandler(FILA.assinaturaPrazos, {
    cron: '*/5 * * * *',
    async processar(_payload, ctx) {
      const agora = (deps.agora ?? (() => new Date()))();
      await (deps.processar ?? ((a, log) => processarPrazos(a, { log })))(agora, (e, c) => ctx.log(e, c));
    },
  });
}

export const assinaturaPrazos = criarAssinaturaPrazos();
