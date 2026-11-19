import type { ContextoEscopado } from '@/server/tenant/context';
import { exigirEscopo } from '@/server/tenant/context';
import { NaoEncontrado } from '@/server/tenant/erros';

import { ehUuid } from './ids';
import type { ProfissionalDTO } from './tipos';
import type { Executor } from './transacao';

export interface RepoProfissional {
  buscarPorId(ctx: ContextoEscopado, id: string): Promise<ProfissionalDTO>;
  /** Ativos e inativos do salão (RN-16), por nome. */
  listar(ctx: ContextoEscopado): Promise<ProfissionalDTO[]>;
  renomear(ctx: ContextoEscopado, id: string, nome: string): Promise<ProfissionalDTO>;
}

const CAMPOS = {
  id: true,
  nome: true,
  email: true,
  usuarioId: true,
  ativo: true,
  criadoEm: true,
  atualizadoEm: true,
} as const;

export function criarRepoProfissional(db: Executor): RepoProfissional {
  async function buscarPorId(ctx: ContextoEscopado, id: string): Promise<ProfissionalDTO> {
    const salaoId = exigirEscopo(ctx);
    if (!ehUuid(id)) {
      throw new NaoEncontrado();
    }
    const profissional = await db.profissional.findFirst({ where: { id, salaoId }, select: CAMPOS });
    if (!profissional) {
      throw new NaoEncontrado();
    }
    return profissional;
  }

  return {
    buscarPorId,

    async listar(ctx) {
      const salaoId = exigirEscopo(ctx);
      return db.profissional.findMany({
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
      const { count } = await db.profissional.updateMany({
        where: { id, salaoId },
        data: { nome },
      });
      if (count === 0) {
        throw new NaoEncontrado();
      }
      return buscarPorId(ctx, id);
    },
  };
}
