import type { ContextoEscopado } from '@/server/tenant/context';
import { exigirEscopo } from '@/server/tenant/context';
import { NaoEncontrado } from '@/server/tenant/erros';

import { ehUuid } from './ids';
import type { ServicoDTO } from './tipos';
import type { Executor } from './transacao';

export interface RepoServico {
  buscarPorId(ctx: ContextoEscopado, id: string): Promise<ServicoDTO>;
  /** Ativos e inativos do salão (RN-16), por nome. */
  listar(ctx: ContextoEscopado): Promise<ServicoDTO[]>;
  renomear(ctx: ContextoEscopado, id: string, nome: string): Promise<ServicoDTO>;
}

const CAMPOS = {
  id: true,
  nome: true,
  precoCentavos: true,
  duracaoMin: true,
  ativo: true,
  criadoEm: true,
  atualizadoEm: true,
} as const;

export function criarRepoServico(db: Executor): RepoServico {
  async function buscarPorId(ctx: ContextoEscopado, id: string): Promise<ServicoDTO> {
    const salaoId = exigirEscopo(ctx);
    if (!ehUuid(id)) {
      throw new NaoEncontrado();
    }
    const servico = await db.servico.findFirst({ where: { id, salaoId }, select: CAMPOS });
    if (!servico) {
      throw new NaoEncontrado();
    }
    return servico;
  }

  return {
    buscarPorId,

    async listar(ctx) {
      const salaoId = exigirEscopo(ctx);
      return db.servico.findMany({
        where: { salaoId },
        select: CAMPOS,
        orderBy: [{ nome: 'asc' }, { id: 'asc' }],
      });
    },

    async renomear(ctx, id, nome) {
      const salaoId = exigirEscopo(ctx);
      if (!ehUuid(id)) {
        throw new NaoEncontrado();
      }
      const { count } = await db.servico.updateMany({ where: { id, salaoId }, data: { nome } });
      if (count === 0) {
        throw new NaoEncontrado();
      }
      return buscarPorId(ctx, id);
    },
  };
}
