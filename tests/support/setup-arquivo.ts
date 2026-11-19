import { afterAll } from 'vitest';

import { configurarPool, encerrarPrisma } from '@/server/repos/db';

import { POOL_MAX_TESTES, recriarBaseDoWorker } from './db';

// setupFiles do projeto `integration`: roda no início de CADA arquivo de teste (CA-15, RN-14).
// Recria a base deste worker a partir do template e aponta DATABASE_URL do processo de teste para ela:
// todo código de produção chamado pelos testes (obterPrisma()) cai na base do worker, nunca na de
// desenvolvimento. O pool é configurado antes do primeiro obterPrisma() do arquivo (CA-16).
process.env.DATABASE_URL = await recriarBaseDoWorker();
configurarPool({ max: POOL_MAX_TESTES });

afterAll(async () => {
  await encerrarPrisma();
});
