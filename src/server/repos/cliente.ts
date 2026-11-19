import type { ContextoEscopado } from '@/server/tenant/context';
import { exigirEscopo } from '@/server/tenant/context';
import { NaoEncontrado } from '@/server/tenant/erros';

import { ehUuid } from './ids';
import type { ClienteDTO } from './tipos';
import type { Executor } from './transacao';

export interface RepoCliente {
  /** Inclui anonimizadas (nome e telefone nulos), RN-16. */
  buscarPorId(ctx: ContextoEscopado, id: string): Promise<ClienteDTO>;
  /** Inclui anonimizadas; ordem de cadastro. */
  listar(ctx: ContextoEscopado): Promise<ClienteDTO[]>;
  /** Só cliente não anonimizada: anonimizada responde NaoEncontrado. */
  renomear(ctx: ContextoEscopado, id: string, nome: string): Promise<ClienteDTO>;
}

const CAMPOS = {
  id: true,
  nome: true,
  telefoneE164: true,
  anonimizadaEm: true,
  criadoEm: true,
  atualizadoEm: true,
} as const;

export function criarRepoCliente(db: Executor): RepoCliente {
  async function buscarPorId(ctx: ContextoEscopado, id: string): Promise<ClienteDTO> {
    const salaoId = exigirEscopo(ctx);
    if (!ehUuid(id)) {
      throw new NaoEncontrado();
    }
    const cliente = await db.cliente.findFirst({ where: { id, salaoId }, select: CAMPOS });
    if (!cliente) {
      throw new NaoEncontrado();
    }
    return cliente;
  }

  return {
    buscarPorId,

    async listar(ctx) {
      const salaoId = exigirEscopo(ctx);
      return db.cliente.findMany({
        where: { salaoId },
        select: CAMPOS,
        orderBy: [{ criadoEm: 'asc' }, { id: 'asc' }],
      });
    },

    async renomear(ctx, id, nome) {
      const salaoId = exigirEscopo(ctx);
      if (!ehUuid(id)) {
        throw new NaoEncontrado();
      }
      const { count } = await db.cliente.updateMany({
        where: { id, salaoId, anonimizadaEm: null },
        data: { nome },
      });
      if (count === 0) {
        throw new NaoEncontrado();
      }
      return buscarPorId(ctx, id);
    },
  };
}
