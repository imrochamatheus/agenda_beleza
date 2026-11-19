import type { ContextoEscopado } from '@/server/tenant/context';
import { exigirEscopo } from '@/server/tenant/context';
import { NaoEncontrado } from '@/server/tenant/erros';

import { ehUuid } from './ids';
import type { Periodo, ReservaDTO, StatusReserva } from './tipos';
import type { Executor } from './transacao';

export interface RepoReserva {
  /** Reserva com itens (snapshot de preço e duração), por ordem. */
  buscarPorId(ctx: ContextoEscopado, id: string): Promise<ReservaDTO>;
  /** Reservas com `inicio` em [de, ate), por início (índice (salao_id, inicio)). */
  listarPorPeriodo(ctx: ContextoEscopado, periodo: Periodo): Promise<ReservaDTO[]>;
  /**
   * PRIMITIVA DE PERSISTÊNCIA (S-9): troca o status só se o atual for `de`; senão NaoEncontrado.
   * Não grava cancelada_em, não incrementa revisão e não enfileira mensagem. Nenhuma ação de produto
   * deve chamá-la diretamente para cancelar ou remarcar: a E3.5 compõe esses fluxos (com a mensagem
   * na mesma transação) sobre ela.
   */
  atualizarStatus(
    ctx: ContextoEscopado,
    id: string,
    transicao: { de: StatusReserva; para: StatusReserva },
  ): Promise<ReservaDTO>;
}

const CAMPOS = {
  id: true,
  profissionalId: true,
  clienteId: true,
  inicio: true,
  fim: true,
  ocupadoAte: true,
  status: true,
  origem: true,
  encaixe: true,
  revisao: true,
  itens: {
    select: { servicoId: true, ordem: true, precoCentavos: true, duracaoMin: true },
    orderBy: { ordem: 'asc' },
  },
} as const;

export function criarRepoReserva(db: Executor): RepoReserva {
  async function buscarPorId(ctx: ContextoEscopado, id: string): Promise<ReservaDTO> {
    const salaoId = exigirEscopo(ctx);
    if (!ehUuid(id)) {
      throw new NaoEncontrado();
    }
    const reserva = await db.reserva.findFirst({ where: { id, salaoId }, select: CAMPOS });
    if (!reserva) {
      throw new NaoEncontrado();
    }
    return reserva;
  }

  return {
    buscarPorId,

    async listarPorPeriodo(ctx, { de, ate }) {
      const salaoId = exigirEscopo(ctx);
      return db.reserva.findMany({
        where: { salaoId, inicio: { gte: de, lt: ate } },
        select: CAMPOS,
        orderBy: [{ inicio: 'asc' }, { id: 'asc' }],
      });
    },

    async atualizarStatus(ctx, id, { de, para }) {
      const salaoId = exigirEscopo(ctx);
      if (!ehUuid(id)) {
        throw new NaoEncontrado();
      }
      const { count } = await db.reserva.updateMany({
        where: { id, salaoId, status: de },
        data: { status: para },
      });
      if (count === 0) {
        throw new NaoEncontrado();
      }
      return buscarPorId(ctx, id);
    },
  };
}
