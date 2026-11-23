import { exigirEscopo } from '@/server/tenant/context';
import type { ContextoEscopado } from '@/server/tenant/context';
import { NaoEncontrado } from '@/server/tenant/erros';

import { ehUuid } from './ids';
import type { ItemDeReservaDTO, OrigemReserva, StatusReserva } from './tipos';
import type { Executor } from './transacao';

// Escrita das operações POR ITEM (D-050 §3.6, T-6): remarcar item, cancelar item, cancelar todos e marcar
// status. Junto com repos/reserva.ts, é o ÚNICO escritor de `reserva_item` no código de produção (dba.md Q1):
// os derivados de `reserva` (status, inicio, fim, cancelada_em) são regravados aqui, na MESMA transação, a
// partir de `derivarReserva` (reservas/itens.ts), sob `reserva FOR UPDATE`.
//
// Posição na ordem canônica de travas (cabeçalho de repos/servico.ts, design §4.6): salão → profissional(is)
// → serviço(s) → cliente (FOR KEY SHARE) → RESERVA (FOR UPDATE, por último entre as de agenda) →
// reserva_item (UPDATE, nunca trava própria antes da reserva) → mensagem. Toda consulta é escopada ao salão.
// Os literais de status ficam no SQL (nunca parâmetro) onde o predicado da exclusion importa.

/** Linha de `reserva` travada FOR UPDATE (derivados atuais e revisão). */
export type ReservaTravada = {
  id: string;
  clienteId: string;
  origem: OrigemReserva;
  status: StatusReserva;
  revisao: number;
  canceladaEm: Date | null;
};

/** Nova posição/serviço de um item remarcado (D-050 A-8: UPDATE do item, nunca apagar/reinserir). */
export type NovaPosicaoDoItem = {
  servicoId: string;
  profissionalId: string;
  inicio: Date;
  fim: Date;
  ocupadoAte: Date;
  precoCentavos: number;
  duracaoMin: number;
  encaixe: boolean;
  /** `reserva.revisao` NOVA (a revisão da mensagem de remarcação). */
  revisao: number;
  agora: Date;
};

export type MudancaDeStatusDosItens = {
  itemIds: readonly string[];
  /** Só muda o item cujo status atual está aqui (guarda otimista; a reserva já está travada). */
  de: readonly StatusReserva[];
  para: StatusReserva;
  /** Revisão gravada no item (cancelar: a nova `reserva.revisao`); null = não mexe (marcar status). */
  revisao: number | null;
  agora: Date;
};

export type DerivadosParaGravar = {
  status: StatusReserva;
  inicio: Date;
  fim: Date;
  canceladaEm: Date | null;
  revisao: number;
  agora: Date;
};

export interface RepoReservaAlteracao {
  /** `SELECT … FOR UPDATE OF r` da reserva do salão; id malformado, inexistente ou de outro salão → NaoEncontrado. */
  travarParaAlterar(ctx: ContextoEscopado, id: string): Promise<ReservaTravada>;
  /** `SELECT … FOR KEY SHARE OF c` da cliente da reserva (antes da reserva, para não inverter a ordem com a anonimização). */
  travarCliente(ctx: ContextoEscopado, clienteId: string): Promise<void>;
  /** Itens da reserva por (inicio, id), DEPOIS da trava da reserva e sem trava própria. Um comando. */
  lerItens(ctx: ContextoEscopado, reservaId: string): Promise<ItemDeReservaDTO[]>;
  /**
   * UPDATE de UM item `confirmado` (o literal fica no WHERE): serviço, snapshot, profissional, posição,
   * encaixe e revisão. Pode lançar 23P01 (`reserva_item_sem_sobreposicao`), que o serviço traduz FORA da
   * transação; o 23505 (`servico_repetido` que escapou à checagem) nunca é capturado. 0 linhas → NaoEncontrado.
   */
  atualizarItem(ctx: ContextoEscopado, reservaId: string, itemId: string, d: NovaPosicaoDoItem): Promise<void>;
  /** UM UPDATE dos itens dados cujo status atual ∈ `de`. Devolve as linhas afetadas. Lista vazia → 0 sem SQL. */
  atualizarStatusDosItens(ctx: ContextoEscopado, reservaId: string, d: MudancaDeStatusDosItens): Promise<number>;
  /** Regrava status/inicio/fim/cancelada_em (derivados) e a revisão da reserva. 0 linhas → NaoEncontrado. */
  gravarDerivados(ctx: ContextoEscopado, reservaId: string, d: DerivadosParaGravar): Promise<void>;
}

type LinhaItem = {
  id: string;
  servico_id: string;
  profissional_id: string;
  ordem: number;
  inicio: Date;
  fim: Date;
  ocupado_ate: Date;
  status: StatusReserva;
  encaixe: boolean;
  revisao: number;
  preco_centavos: number;
  duracao_min: number;
};

export function criarRepoReservaAlteracao(db: Executor): RepoReservaAlteracao {
  return {
    async travarParaAlterar(ctx, id) {
      const salaoId = exigirEscopo(ctx);
      if (!ehUuid(id)) throw new NaoEncontrado();
      const linhas = await db.$queryRaw<
        { id: string; cliente_id: string; origem: OrigemReserva; status: StatusReserva; revisao: number; cancelada_em: Date | null }[]
      >`
        SELECT r.id::text AS id, r.cliente_id::text AS cliente_id, r.origem::text AS origem, r.status::text AS status,
               r.revisao, r.cancelada_em
          FROM reserva r
         WHERE r.id = ${id}::uuid AND r.salao_id = ${salaoId}::uuid
           FOR UPDATE OF r`;
      const l = linhas[0];
      if (!l) throw new NaoEncontrado();
      return { id: l.id, clienteId: l.cliente_id, origem: l.origem, status: l.status, revisao: l.revisao, canceladaEm: l.cancelada_em };
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

    async lerItens(ctx, reservaId) {
      const salaoId = exigirEscopo(ctx);
      if (!ehUuid(reservaId)) throw new NaoEncontrado();
      const linhas = await db.$queryRaw<LinhaItem[]>`
        SELECT i.id::text AS id, i.servico_id::text AS servico_id, i.profissional_id::text AS profissional_id,
               i.ordem::int AS ordem, i.inicio, i.fim, i.ocupado_ate, i.status::text AS status, i.encaixe, i.revisao,
               i.preco_centavos, i.duracao_min
          FROM reserva_item i
         WHERE i.salao_id = ${salaoId}::uuid AND i.reserva_id = ${reservaId}::uuid
         ORDER BY i.inicio, i.id`;
      return linhas.map((l) => ({
        id: l.id,
        servicoId: l.servico_id,
        profissionalId: l.profissional_id,
        ordem: l.ordem,
        inicio: l.inicio,
        fim: l.fim,
        ocupadoAte: l.ocupado_ate,
        status: l.status,
        encaixe: l.encaixe,
        revisao: l.revisao,
        precoCentavos: l.preco_centavos,
        duracaoMin: l.duracao_min,
      }));
    },

    async atualizarItem(ctx, reservaId, itemId, d) {
      const salaoId = exigirEscopo(ctx);
      if (!ehUuid(reservaId) || !ehUuid(itemId) || !ehUuid(d.servicoId) || !ehUuid(d.profissionalId)) throw new NaoEncontrado();
      const n = await db.$executeRaw`
        UPDATE reserva_item
           SET servico_id = ${d.servicoId}::uuid, profissional_id = ${d.profissionalId}::uuid,
               inicio = ${d.inicio}::timestamptz, fim = ${d.fim}::timestamptz, ocupado_ate = ${d.ocupadoAte}::timestamptz,
               preco_centavos = ${d.precoCentavos}::int, duracao_min = ${d.duracaoMin}::int, encaixe = ${d.encaixe},
               revisao = ${d.revisao}::int, atualizado_em = ${d.agora}::timestamptz
         WHERE id = ${itemId}::uuid AND reserva_id = ${reservaId}::uuid AND salao_id = ${salaoId}::uuid
           AND status = 'confirmado'`;
      if (n === 0) throw new NaoEncontrado();
    },

    async atualizarStatusDosItens(ctx, reservaId, d) {
      const salaoId = exigirEscopo(ctx);
      if (!ehUuid(reservaId) || !d.itemIds.every((id) => ehUuid(id))) throw new NaoEncontrado();
      if (d.itemIds.length === 0 || d.de.length === 0) return 0;
      return db.$executeRaw`
        UPDATE reserva_item
           SET status = ${d.para}::status_reserva, revisao = COALESCE(${d.revisao}::int, revisao),
               atualizado_em = ${d.agora}::timestamptz
         WHERE salao_id = ${salaoId}::uuid AND reserva_id = ${reservaId}::uuid
           AND id = ANY(${[...d.itemIds]}::uuid[]) AND status = ANY(${[...d.de]}::status_reserva[])`;
    },

    async gravarDerivados(ctx, reservaId, d) {
      const salaoId = exigirEscopo(ctx);
      if (!ehUuid(reservaId)) throw new NaoEncontrado();
      const n = await db.$executeRaw`
        UPDATE reserva
           SET status = ${d.status}::status_reserva, inicio = ${d.inicio}::timestamptz, fim = ${d.fim}::timestamptz,
               cancelada_em = ${d.canceladaEm}::timestamptz, revisao = ${d.revisao}::int,
               atualizado_em = ${d.agora}::timestamptz
         WHERE id = ${reservaId}::uuid AND salao_id = ${salaoId}::uuid`;
      if (n === 0) throw new NaoEncontrado();
    },
  };
}
