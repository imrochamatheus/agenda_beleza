import type { TestProject } from 'vitest/node';

import { novoExec, validarPlanoDeBases, type PlanoDeBases } from './banco';
import {
  apagarBasesDaExecucao,
  apagarOrfas,
  INICIALIZADORES,
  prepararTemplate,
  type InicializadorDeSchema,
} from './db';

declare module 'vitest' {
  export interface ProvidedContext {
    /** Plano das bases desta execução (template + base por worker). */
    bancoDeTeste: PlanoDeBases;
    /** Instante (ms desde a época) em que o preparo desta execução começou. Usado pelo CA-22 da D-004. */
    inicioDoReset: number;
  }
}

/**
 * Prepara a execução (§3.6 do desenho, passos 1 a 6). A guarda é a 1ª instrução: nada se conecta antes
 * dela (CA-17). Exportada para o teste do CA-17 com porta fechada.
 */
export async function prepararExecucao(
  env: { TEST_DATABASE_URL?: string; DATABASE_URL?: string },
  maxWorkers: number,
  inicializadores: readonly InicializadorDeSchema[] = INICIALIZADORES,
): Promise<PlanoDeBases> {
  const plano = validarPlanoDeBases(env, novoExec(), maxWorkers);
  await apagarOrfas(plano);
  await prepararTemplate(plano, inicializadores);
  return plano;
}

// globalSetup do projeto Vitest `integration`: prepara o template uma vez por execução; o teardown
// apaga as bases da execução (workers e template).
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const inicioDoReset = Date.now();
  const plano = await prepararExecucao(
    { TEST_DATABASE_URL: process.env.TEST_DATABASE_URL, DATABASE_URL: process.env.DATABASE_URL },
    project.config.maxWorkers,
  );
  project.provide('bancoDeTeste', plano);
  project.provide('inicioDoReset', inicioDoReset);
  return async () => {
    await apagarBasesDaExecucao(plano);
  };
}
