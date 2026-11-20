import type { ContextoEscopado } from '@/server/tenant/context';
import { exigirEscopo } from '@/server/tenant/context';
import { NaoEncontrado } from '@/server/tenant/erros';

import { ehUuid } from './ids';
import type { Periodo, ReservaBloqueanteDTO, ReservaDTO, StatusReserva } from './tipos';
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
  /**
   * Reservas que impedem desativar o profissional (D-013 RN-2, D-1): `status = 'confirmado'` e
   * `fim > agora` (inclui a em andamento), do profissional, no salão do contexto. Ordem: inicio, id.
   * Traz o nome da cliente (null se anonimizada; o telefone nunca é lido) e os nomes atuais dos
   * serviços na ordem dos itens. ID malformado → NaoEncontrado sem consultar.
   */
  listarBloqueantesDeDesativacao(
    ctx: ContextoEscopado,
    profissionalId: string,
    agora: Date,
  ): Promise<ReservaBloqueanteDTO[]>;
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

    async listarBloqueantesDeDesativacao(ctx, profissionalId, agora) {
      const salaoId = exigirEscopo(ctx);
      if (!ehUuid(profissionalId)) {
        throw new NaoEncontrado();
      }
      const linhas = await db.reserva.findMany({
        where: { salaoId, profissionalId, status: 'confirmado', fim: { gt: agora } },
        select: {
          id: true,
          inicio: true,
          fim: true,
          cliente: { select: { nome: true } },
          itens: { select: { servico: { select: { nome: true } } }, orderBy: { ordem: 'asc' } },
        },
        orderBy: [{ inicio: 'asc' }, { id: 'asc' }],
      });
      return linhas.map((r) => ({
        id: r.id,
        inicio: r.inicio,
        fim: r.fim,
        clienteNome: r.cliente.nome,
        servicos: r.itens.map((i) => i.servico.nome),
      }));
    },
  };
}
