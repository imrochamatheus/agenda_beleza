import { Prisma } from '@/generated/prisma/client';
import type { PrismaClient } from '@/generated/prisma/client';

import { obterPrisma } from './db';
import { criarRepos } from './index';
import type { Repos } from './index';

/** Cliente padrão ou transação interativa. Tipo interno a repos/**. */
export type Executor = PrismaClient | Prisma.TransactionClient;

/**
 * Unidade de trabalho (CA-14): `fn` recebe repositórios já ligados a uma transação interativa
 * (READ COMMITTED). Qualquer erro lançado em `fn` desfaz tudo e é relançado. Não há transação
 * "ambiente": fora de `fn`, nada participa dela.
 */
export async function emTransacao<T>(fn: (r: Repos) => Promise<T>): Promise<T> {
  return obterPrisma().$transaction((tx) => fn(criarRepos(tx)), {
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
  });
}
