import type { TestProject } from 'vitest/node';

import { prepararBancoDeTeste } from './db';

declare module 'vitest' {
  export interface ProvidedContext {
    /** Instante (ms desde a época) em que o reset desta execução começou. Usado pelo teste do CA-22. */
    inicioDoReset: number;
  }
}

// globalSetup do projeto Vitest `integration`: reseta o schema e migra uma vez por execução.
// Sem teardown: os dados ficam para depuração, e a próxima execução reseta.
export default async function setup(project: TestProject): Promise<void> {
  const inicioDoReset = Date.now();
  await prepararBancoDeTeste();
  project.provide('inicioDoReset', inicioDoReset);
}
