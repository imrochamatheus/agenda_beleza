import { exigirEscopo } from '@/server/tenant/context';
import type { ContextoEscopado } from '@/server/tenant/context';
import { NaoEncontrado } from '@/server/tenant/erros';

import { ehUuid } from './ids';
import type { NovoItemDeReserva } from './reserva';
import type { StatusReserva } from './tipos';
import type { Executor } from './transacao';

// Escrita de remarcar, cancelar e marcar status (D-030). Posição na ordem canônica de travas (cabeçalho de
// repos/servico.ts): salão → profissional(is) → serviço(s) → cliente (FOR KEY SHARE) → RESERVA (FOR UPDATE,
// por último entre as de agenda) → reserva_item → mensagem. Toda consulta é escopada ao salão do contexto.

export type ReservaTravada = {
  id: string;
  profissionalId: string;
  clienteId: string;
  origem: 'publico' | 'equipe';
  status: StatusReserva;
  inicio: Date;
  fim: Date;
  ocupadoAte: Date;
  encaixe: boolean;
  revisao: number;
};

export type NovaPosicao = {
  profissionalId: string;
  inicio: Date;
  fim: Date;
  ocupadoAte: Date;
  encaixe: boolean;
  agora: Date;
};

export type ItemDeReservaGravado = NovoItemDeReserva;

export interface RepoReservaAlteracao {
  /** `SELECT … FOR UPDATE OF r` da reserva do salão; id malformado, inexistente ou de outro salão → NaoEncontrado. */
  travarParaAlterar(ctx: ContextoEscopado, id: string): Promise<ReservaTravada>;
  /** `SELECT … FOR KEY SHARE OF c` da cliente da reserva (antes da reserva, para não inverter a ordem com a anonimização). */
  travarCliente(ctx: ContextoEscopado, clienteId: string): Promise<void>;
  /**
   * UPDATE da MESMA linha: posição, profissional, encaixe, `revisao = revisao + 1`, `atualizado_em`. O literal
   * 'confirmado' fica no WHERE (índice parcial da exclusion). Pode lançar 23P01, que o serviço traduz FORA da
   * transação. Devolve a nova revisão; 0 linhas → NaoEncontrado.
   */
  atualizarPosicao(ctx: ContextoEscopado, id: string, d: NovaPosicao): Promise<number>;
  /** Troca o status só se o atual for `de`; `cancelada_em` só no cancelamento; 0 linhas → NaoEncontrado. */
  atualizarStatus(
    ctx: ContextoEscopado,
    id: string,
    d: { de: StatusReserva; para: StatusReserva; agora: Date },
  ): Promise<void>;
  lerItens(ctx: ContextoEscopado, reservaId: string): Promise<ItemDeReservaGravado[]>;
  /**
   * Diff por `servico_id`: apaga os removidos, regrava a `ordem` dos mantidos (em ordem crescente, nunca
   * colidindo com a unicidade) e insere os acrescentados; o snapshot dos mantidos não é tocado.
   */
  substituirItens(
    ctx: ContextoEscopado,
    reservaId: string,
    d: { remover: readonly string[]; reordenar: readonly { servicoId: string; ordem: number }[]; adicionar: readonly NovoItemDeReserva[] },
  ): Promise<void>;
}

export function criarRepoReservaAlteracao(db: Executor): RepoReservaAlteracao {
  return {
    async travarParaAlterar(ctx, id) {
      const salaoId = exigirEscopo(ctx);
      if (!ehUuid(id)) throw new NaoEncontrado();
      const linhas = await db.$queryRaw<
        {
          id: string;
          profissional_id: string;
          cliente_id: string;
          origem: 'publico' | 'equipe';
          status: StatusReserva;
          inicio: Date;
          fim: Date;
          ocupado_ate: Date;
          encaixe: boolean;
          revisao: number;
        }[]
      >`
        SELECT r.id::text AS id, r.profissional_id::text AS profissional_id, r.cliente_id::text AS cliente_id,
               r.origem::text AS origem, r.status::text AS status, r.inicio, r.fim, r.ocupado_ate, r.encaixe, r.revisao
          FROM reserva r
         WHERE r.id = ${id}::uuid AND r.salao_id = ${salaoId}::uuid
           FOR UPDATE OF r`;
      const l = linhas[0];
      if (!l) throw new NaoEncontrado();
      return {
        id: l.id,
        profissionalId: l.profissional_id,
        clienteId: l.cliente_id,
        origem: l.origem,
        status: l.status,
        inicio: l.inicio,
        fim: l.fim,
        ocupadoAte: l.ocupado_ate,
        encaixe: l.encaixe,
        revisao: l.revisao,
      };
    },

    async travarCliente(ctx, clienteId) {
      const salaoId = exigirEscopo(ctx);
      if (!ehUuid(clienteId)) throw new NaoEncontrado();
      const linhas = await db.$queryRaw<{ id: string }[]>`
        SELECT c.id::text AS id FROM cliente c
         WHERE c.id = ${clienteId}::uuid AND c.salao_id = ${salaoId}::uuid
           FOR KEY SHARE OF c`;
      if (linhas.length === 0) throw new NaoEncontrado();
    },

    async atualizarPosicao(ctx, id, d) {
      const salaoId = exigirEscopo(ctx);
      if (!ehUuid(id) || !ehUuid(d.profissionalId)) throw new NaoEncontrado();
      const linhas = await db.$queryRaw<{ revisao: number }[]>`
        UPDATE reserva
           SET profissional_id = ${d.profissionalId}::uuid, inicio = ${d.inicio}::timestamptz,
               fim = ${d.fim}::timestamptz, ocupado_ate = ${d.ocupadoAte}::timestamptz,
               encaixe = ${d.encaixe}, revisao = revisao + 1, atualizado_em = ${d.agora}::timestamptz
         WHERE id = ${id}::uuid AND salao_id = ${salaoId}::uuid AND status = 'confirmado'
        RETURNING revisao`;
      if (linhas.length === 0) throw new NaoEncontrado();
      return linhas[0].revisao;
    },

    async atualizarStatus(ctx, id, { de, para, agora }) {
      const salaoId = exigirEscopo(ctx);
      if (!ehUuid(id)) throw new NaoEncontrado();
      const canceladaEm = para === 'cancelado' ? agora : null;
      const n = await db.$executeRaw`
        UPDATE reserva
           SET status = ${para}::status_reserva, cancelada_em = COALESCE(${canceladaEm}::timestamptz, cancelada_em),
               atualizado_em = ${agora}::timestamptz
         WHERE id = ${id}::uuid AND salao_id = ${salaoId}::uuid AND status = ${de}::status_reserva`;
      if (n === 0) throw new NaoEncontrado();
    },

    async lerItens(ctx, reservaId) {
      const salaoId = exigirEscopo(ctx);
      if (!ehUuid(reservaId)) throw new NaoEncontrado();
      return db.reservaItem.findMany({
        where: { salaoId, reservaId },
        select: { servicoId: true, ordem: true, precoCentavos: true, duracaoMin: true },
        orderBy: { ordem: 'asc' },
      });
    },

    async substituirItens(ctx, reservaId, d) {
      const salaoId = exigirEscopo(ctx);
      if (!ehUuid(reservaId)) throw new NaoEncontrado();
      if (d.remover.length > 0) {
        await db.reservaItem.deleteMany({ where: { salaoId, reservaId, servicoId: { in: [...d.remover] } } });
      }
      for (const { servicoId, ordem } of [...d.reordenar].sort((a, b) => a.ordem - b.ordem)) {
        await db.reservaItem.updateMany({ where: { salaoId, reservaId, servicoId }, data: { ordem } });
      }
      if (d.adicionar.length > 0) {
        await db.reservaItem.createMany({
          data: d.adicionar.map((i) => ({ salaoId, reservaId, servicoId: i.servicoId, ordem: i.ordem, precoCentavos: i.precoCentavos, duracaoMin: i.duracaoMin })),
        });
      }
    },
  };
}
