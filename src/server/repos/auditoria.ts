import { Prisma } from '@/generated/prisma/client';
import type { EntradaAuditoriaValidada } from '@/server/auditoria/tipos';

import { obterPrisma } from './db';
import type { Executor } from './transacao';

// Auditoria (D-033, E8.1): este é o ÚNICO arquivo que toca a tabela `auditoria`, e só INSERE (os
// triggers do banco rejeitam UPDATE/DELETE/TRUNCATE). Sem escopo de tenant: a tabela é de plataforma
// e quem decide o ator é o serviço (`registrarAuditoria`, que exige AdminContext). Ordem de travas:
// ÚLTIMA; o INSERT só toma FOR KEY SHARE em usuario/salao (FK), que não conflita com NO KEY UPDATE.

export interface RepoAuditoria {
  /** INSERT único. A entrada vem validada pelo serviço; FK inexistente propaga como erro de banco. */
  inserir(e: EntradaAuditoriaValidada): Promise<{ id: string }>;
}

export function criarRepoAuditoria(db: Executor): RepoAuditoria {
  return {
    async inserir(e) {
      const linha = await db.auditoria.create({
        data: {
          atorId: e.atorId,
          atorEmailInformado: e.atorEmailInformado,
          acao: e.acao,
          entidade: e.entidade,
          entidadeId: e.entidadeId,
          salaoId: e.salaoId,
          antes: e.antes ?? Prisma.DbNull,
          depois: e.depois ?? Prisma.DbNull,
          resultado: e.resultado,
        },
        select: { id: true },
      });
      return { id: linha.id };
    },
  };
}

/**
 * INSERT em conexão própria do pool, fora de qualquer transação do chamador (resultado `falha`,
 * RN-2). Persiste mesmo se a transação principal sofrer rollback.
 */
export function inserirAuditoriaIndependente(e: EntradaAuditoriaValidada): Promise<{ id: string }> {
  return criarRepoAuditoria(obterPrisma()).inserir(e);
}
