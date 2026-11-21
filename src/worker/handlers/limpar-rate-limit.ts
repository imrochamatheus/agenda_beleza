import { limparJanelasExpiradas } from '@/server/protecao/limpeza';
import { FILA } from '@/server/queue/filas';

import { definirHandler } from './tipos';

export type DependenciasLimpeza = {
  agora?: () => Date;
  limpar?: (agora: Date) => Promise<number>;
};

/** Limpeza horária (UTC, minuto 17) das janelas expiradas de `rate_limit_janela` (D-027 RN-8). O log traz só a contagem. */
export function criarLimparRateLimit(deps: DependenciasLimpeza = {}) {
  return definirHandler(FILA.limparRateLimit, {
    cron: '17 * * * *',
    async processar(_payload, ctx) {
      const agora = (deps.agora ?? (() => new Date()))();
      const apagadas = await (deps.limpar ?? limparJanelasExpiradas)(agora);
      ctx.log('limpar-rate-limit.concluido', { apagadas });
    },
  });
}

export const limparRateLimit = criarLimparRateLimit();
