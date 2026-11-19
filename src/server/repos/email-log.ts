import type { PrismaClient } from '@/generated/prisma/client';

import { obterPrisma } from './db';

// Repositório de PLATAFORMA do e-mail simulado (D-007 §3.10). Exceção documentada à RN-8, como
// sessao.ts: `email_log` não pertence a um salão, então não há ContextoEscopado. Recebe só um
// CLIENTE (nunca uma transação do chamador): o simulado grava fora da transação de quem o chama,
// como um provedor real (RN-15). Sem cliente, usa `obterPrisma()` resolvido em cada chamada.

export type LinhaEmailLog = {
  id: string;
  destinatario: string;
  assunto: string;
  corpo: string;
  criadoEm: Date;
};

export interface RepoEmailLog {
  registrar(e: { destinatario: string; assunto: string; corpo: string }): Promise<{ id: string }>;
  /** Mais recentes primeiro (índice `(destinatario, criado_em DESC)`). */
  listarPorDestinatario(destinatario: string): Promise<LinhaEmailLog[]>;
}

export function repoEmailLog(db?: PrismaClient): RepoEmailLog {
  const cliente = () => db ?? obterPrisma();
  return {
    async registrar({ destinatario, assunto, corpo }) {
      return cliente().emailLog.create({ data: { destinatario, assunto, corpo }, select: { id: true } });
    },

    async listarPorDestinatario(destinatario) {
      return cliente().emailLog.findMany({
        where: { destinatario },
        select: { id: true, destinatario: true, assunto: true, corpo: true, criadoEm: true },
        orderBy: [{ criadoEm: 'desc' }, { id: 'desc' }],
      });
    },
  };
}
