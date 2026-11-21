import type { ContextoEscopado } from '@/server/tenant/context';
import { exigirEscopo } from '@/server/tenant/context';
import { NaoEncontrado } from '@/server/tenant/erros';

import { ehUuid } from './ids';
import type { StatusReserva } from './tipos';
import type { Executor } from './transacao';

// Avaliações verificadas (D-032), repositório escopado. Ordem canônica de travas (cabeçalho de
// repos/servico.ts): salão → … → reserva → cliente → mensagem → CONVITE → AVALIAÇÃO (últimas).
// O envio trava `reserva FOR SHARE` → `cliente FOR SHARE` → `convite FOR UPDATE`, nessa ordem: status
// e anonimização ficam congelados até o commit e esperam o envio, sem ciclo. Nenhuma operação captura
// 23505: a trava do convite serializa e o UNIQUE é só rede de segurança. O token nunca chega aqui:
// só o hash.

export type ConviteLocalizado = { conviteId: string; reservaId: string };
export type ReservaTravada = { status: StatusReserva; clienteId: string };
export type ClienteTravado = { nome: string | null; anonimizadaEm: Date | null };
export type ConviteTravado = { usadoEm: Date | null; invalidadoEm: Date | null; expiraEm: Date };

export type NovaAvaliacao = {
  reservaId: string;
  clienteId: string;
  nota: number;
  comentario: string | null;
  nomeExibicao: string;
  versaoTermos: string;
  agora: Date;
};

export interface RepoAvaliacao {
  /**
   * Gerador do link (RN-5): só para reserva `concluido` de cliente não anonimizada do salão. Cria o
   * convite com `ON CONFLICT (reserva_id) DO NOTHING` (nunca renova) e devolve o slug atual; `null`
   * se a reserva não é elegível.
   */
  garantirConvite(
    ctx: ContextoEscopado,
    d: { reservaId: string; tokenHash: string; expiraEm: Date; agora: Date },
  ): Promise<{ slug: string } | null>;
  /** Convite do salão pelo hash, sem trava (passo 0 do envio). */
  localizarConvite(ctx: ContextoEscopado, tokenHash: string): Promise<ConviteLocalizado | null>;
  /** `reserva … FOR SHARE`. */
  travarReserva(ctx: ContextoEscopado, reservaId: string): Promise<ReservaTravada | null>;
  /** `cliente … FOR SHARE`. */
  travarCliente(ctx: ContextoEscopado, clienteId: string): Promise<ClienteTravado | null>;
  /** `avaliacao_convite … FOR UPDATE`. */
  travarConvite(ctx: ContextoEscopado, conviteId: string): Promise<ConviteTravado | null>;
  /** INSERT … ON CONFLICT (reserva_id) DO NOTHING; `false` se já existia (nunca 23505). */
  inserir(ctx: ContextoEscopado, d: NovaAvaliacao): Promise<boolean>;
  /** UPDATE … WHERE usado_em IS NULL; `false` se outro já usou. */
  marcarUsado(ctx: ContextoEscopado, conviteId: string, agora: Date): Promise<boolean>;
  /**
   * RN-10: apaga nome e comentário das avaliações da cliente e invalida os convites das suas reservas.
   * Roda na transação da anonimização, depois do cliente e das mensagens.
   */
  anonimizarDaCliente(
    ctx: ContextoEscopado,
    clienteId: string,
    agora: Date,
  ): Promise<{ avaliacoes: number; convites: number }>;
}

function exigirIds(...ids: unknown[]): void {
  if (!ids.every((i) => ehUuid(i))) throw new NaoEncontrado();
}

export function criarRepoAvaliacao(db: Executor): RepoAvaliacao {
  return {
    async garantirConvite(ctx, d) {
      const salaoId = exigirEscopo(ctx);
      if (!ehUuid(d.reservaId)) return null;
      const linhas = await db.$queryRaw<{ slug: string }[]>`
        WITH alvo AS (
          SELECT r.id, sl.slug
            FROM reserva r
            JOIN cliente c ON c.salao_id = r.salao_id AND c.id = r.cliente_id
            JOIN salao_slug sl ON sl.salao_id = r.salao_id AND sl.atual
           WHERE r.salao_id = ${salaoId}::uuid AND r.id = ${d.reservaId}::uuid
             AND r.status = 'concluido' AND c.anonimizada_em IS NULL
        ), ins AS (
          INSERT INTO avaliacao_convite (salao_id, reserva_id, token_hash, expira_em, criado_em)
          SELECT ${salaoId}::uuid, alvo.id, ${d.tokenHash}, ${d.expiraEm}::timestamptz, ${d.agora}::timestamptz
            FROM alvo
          ON CONFLICT (reserva_id) DO NOTHING
          RETURNING id
        )
        SELECT slug FROM alvo`;
      return linhas.length === 0 ? null : { slug: linhas[0].slug };
    },

    async localizarConvite(ctx, tokenHash) {
      const salaoId = exigirEscopo(ctx);
      const linhas = await db.$queryRaw<{ id: string; reserva_id: string }[]>`
        SELECT id, reserva_id FROM avaliacao_convite
         WHERE salao_id = ${salaoId}::uuid AND token_hash = ${tokenHash}`;
      return linhas.length === 0 ? null : { conviteId: linhas[0].id, reservaId: linhas[0].reserva_id };
    },

    async travarReserva(ctx, reservaId) {
      const salaoId = exigirEscopo(ctx);
      exigirIds(reservaId);
      const linhas = await db.$queryRaw<{ status: StatusReserva; cliente_id: string }[]>`
        SELECT status::text AS status, cliente_id FROM reserva
         WHERE salao_id = ${salaoId}::uuid AND id = ${reservaId}::uuid
           FOR SHARE`;
      return linhas.length === 0 ? null : { status: linhas[0].status, clienteId: linhas[0].cliente_id };
    },

    async travarCliente(ctx, clienteId) {
      const salaoId = exigirEscopo(ctx);
      exigirIds(clienteId);
      const linhas = await db.$queryRaw<{ nome: string | null; anonimizada_em: Date | null }[]>`
        SELECT nome, anonimizada_em FROM cliente
         WHERE salao_id = ${salaoId}::uuid AND id = ${clienteId}::uuid
           FOR SHARE`;
      return linhas.length === 0 ? null : { nome: linhas[0].nome, anonimizadaEm: linhas[0].anonimizada_em };
    },

    async travarConvite(ctx, conviteId) {
      const salaoId = exigirEscopo(ctx);
      exigirIds(conviteId);
      const linhas = await db.$queryRaw<{ usado_em: Date | null; invalidado_em: Date | null; expira_em: Date }[]>`
        SELECT usado_em, invalidado_em, expira_em FROM avaliacao_convite
         WHERE salao_id = ${salaoId}::uuid AND id = ${conviteId}::uuid
           FOR UPDATE`;
      return linhas.length === 0
        ? null
        : { usadoEm: linhas[0].usado_em, invalidadoEm: linhas[0].invalidado_em, expiraEm: linhas[0].expira_em };
    },

    async inserir(ctx, d) {
      const salaoId = exigirEscopo(ctx);
      exigirIds(d.reservaId, d.clienteId);
      const linhas = await db.$queryRaw<{ id: string }[]>`
        INSERT INTO avaliacao (salao_id, reserva_id, cliente_id, nota, comentario, nome_exibicao,
                               publicacao_aceita_em, versao_termos, criado_em)
        VALUES (${salaoId}::uuid, ${d.reservaId}::uuid, ${d.clienteId}::uuid, ${d.nota}::smallint,
                ${d.comentario}, ${d.nomeExibicao}, ${d.agora}::timestamptz, ${d.versaoTermos},
                ${d.agora}::timestamptz)
        ON CONFLICT (reserva_id) DO NOTHING
        RETURNING id`;
      return linhas.length > 0;
    },

    async marcarUsado(ctx, conviteId, agora) {
      const salaoId = exigirEscopo(ctx);
      exigirIds(conviteId);
      const n = await db.$executeRaw`
        UPDATE avaliacao_convite SET usado_em = ${agora}::timestamptz
         WHERE salao_id = ${salaoId}::uuid AND id = ${conviteId}::uuid AND usado_em IS NULL`;
      return n === 1;
    },

    async anonimizarDaCliente(ctx, clienteId, agora) {
      const salaoId = exigirEscopo(ctx);
      exigirIds(clienteId);
      const avaliacoes = await db.$executeRaw`
        UPDATE avaliacao SET nome_exibicao = NULL, comentario = NULL
         WHERE salao_id = ${salaoId}::uuid AND cliente_id = ${clienteId}::uuid`;
      const convites = await db.$executeRaw`
        UPDATE avaliacao_convite SET invalidado_em = ${agora}::timestamptz
         WHERE salao_id = ${salaoId}::uuid AND invalidado_em IS NULL
           AND reserva_id IN (SELECT id FROM reserva WHERE salao_id = ${salaoId}::uuid AND cliente_id = ${clienteId}::uuid)`;
      return { avaliacoes, convites };
    },
  };
}
