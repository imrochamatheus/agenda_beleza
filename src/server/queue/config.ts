import type { ConstructorOptions } from 'pg-boss';

import type { Env } from '@/server/env';

// Configuração única da fila (D-008 §3.2): worker, cliente da app e harness de teste usam as mesmas
// opções, então o schema instalado no template é o mesmo que o worker instalaria.

/** Schema do pg-boss, separado do `public` gerido pelo Prisma (RN-1, RN-7). */
export const SCHEMA_FILA = 'pgboss';

/** Tamanho do pool de conexões por papel (D-2; orçamento em docs/demandas/D-008/dba.md). */
export const POOL_FILA = { worker: 4, app: 2, instalador: 1 } as const;

/** `application_name` das conexões de cada papel (diagnóstico em pg_stat_activity; R-3). */
export const APLICACAO_FILA = {
  worker: 'agenda-beleza:worker',
  app: 'agenda-beleza:app',
  instalador: 'agenda-beleza:instalador',
} as const;

export type PapelFila = keyof typeof POOL_FILA;

/**
 * Opções do construtor do pg-boss por papel. Só o `worker` migra, supervisiona e agenda (D-6);
 * o `instalador` (harness) só instala o schema; a `app` não instala, não migra nem agenda.
 */
export function opcoesPgBoss(url: string, papel: PapelFila): ConstructorOptions {
  const comum: ConstructorOptions = {
    connectionString: url,
    schema: SCHEMA_FILA,
    max: POOL_FILA[papel],
    application_name: APLICACAO_FILA[papel],
  };
  switch (papel) {
    case 'worker':
      return {
        ...comum,
        migrate: true,
        supervise: true,
        schedule: true,
        registerInstance: true,
        instanceName: 'worker',
      };
    case 'app':
      return { ...comum, migrate: false, supervise: false, schedule: false, registerInstance: false };
    case 'instalador':
      return { ...comum, migrate: true, supervise: false, schedule: false, registerInstance: false };
  }
}

export type PoliticaRetry = { retryLimit: number; retryDelay: number; retryBackoff: boolean };

/** RN-9: a única fonte da política de retry (cliente, filas e agendamentos). */
export function politicaDeRetry(env: Pick<Env, 'fila'>): PoliticaRetry {
  return {
    retryLimit: env.fila.retryLimit,
    retryDelay: env.fila.retryDelaySeconds,
    retryBackoff: env.fila.retryBackoff,
  };
}
