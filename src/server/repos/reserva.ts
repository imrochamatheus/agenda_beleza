import { Prisma } from '@/generated/prisma/client';
import type { ContextoEscopado } from '@/server/tenant/context';
import { exigirEscopo } from '@/server/tenant/context';
import { NaoEncontrado } from '@/server/tenant/erros';

import { ehUuid } from './ids';
import type { Periodo, ReservaBloqueanteDTO, ReservaCobertaDTO, ReservaDTO, StatusReserva } from './tipos';
import type { Executor } from './transacao';

export type NovaReserva = {
  profissionalId: string;
  clienteId: string;
  inicio: Date;
  fim: Date;
  ocupadoAte: Date;
  origem: 'publico' | 'equipe';
  encaixe: boolean;
  chaveRequisicao: string | null;
};

export type NovoItemDeReserva = { servicoId: string; ordem: number; precoCentavos: number; duracaoMin: number };

export interface RepoReserva {
  /**
   * D-025 A-5: INSERT de uma reserva `confirmado`, revisão 0, com `ON CONFLICT (salao_id,
   * chave_requisicao) DO NOTHING RETURNING id`: `criada: false` = outra requisição com a mesma chave
   * já a gravou (o PostgreSQL espera o commit dela). NÃO captura o 23P01 da exclusion (o serviço o
   * traduz fora da transação). O literal 'confirmado' fica no texto (índice parcial da exclusion).
   */
  criar(ctx: ContextoEscopado, d: NovaReserva): Promise<{ criada: true; id: string } | { criada: false }>;
  /** Um `createMany` (um comando) com os itens e o snapshot de preço e duração. */
  criarItens(ctx: ContextoEscopado, reservaId: string, itens: readonly NovoItemDeReserva[]): Promise<void>;
  /** Reserva do salão com a chave (índice UNIQUE); chave não UUID → null sem consultar. */
  buscarPorChave(ctx: ContextoEscopado, chave: string): Promise<ReservaDTO | null>;
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
  /**
   * Reservas sob um bloqueio (D-016 RN-8): `status = 'confirmado'` e [inicio, fim) && [de, ate) (sem
   * ocupado_ate, spec D-7), no salão do contexto; `profissionalId` → só dele; null → de todos os
   * profissionais do salão. Ordem: inicio, id. No máximo `limite` itens; `total` é a contagem completa.
   * Traz o nome do profissional e o da cliente (null se anonimizada); o telefone NUNCA é lido.
   * profissionalId malformado → NaoEncontrado sem consultar. Ver consultaReservasQueCruzam.
   */
  listarConfirmadasQueCruzam(
    ctx: ContextoEscopado,
    periodo: Periodo,
    profissionalId: string | null,
    limite: number,
  ): Promise<{ reservas: ReservaCobertaDTO[]; total: number }>;
}

type LinhaCoberta = {
  id: string;
  profissional_id: string;
  profissional_nome: string;
  inicio: Date;
  fim: Date;
  cliente_nome: string | null;
  total: bigint;
};

/**
 * SQL de listarConfirmadasQueCruzam (exportado só para o teste de plano, D-016 R-3). O literal
 * 'confirmado' e o predicado redundante `tstzrange(r.inicio, r.ocupado_ate, '[)') && …` ficam NO TEXTO
 * para o planejador provar a implicação com o predicado do índice parcial `reserva_sem_sobreposicao`
 * (GiST da exclusion) e usá-lo, inclusive com plano genérico. NÃO troque o literal por parâmetro nem
 * junte as duas variantes num `$p IS NULL OR …` (o plano perde o índice). O filtro exato
 * `r.inicio < ate AND r.fim > de` vem junto, porque [inicio, ocupado_ate) é um superconjunto.
 * Seleciona c.nome e nunca c.telefone_e164.
 */
export function consultaReservasQueCruzam(
  salaoId: string,
  { de, ate }: Periodo,
  profissionalId: string | null,
  limite: number,
): Prisma.Sql {
  const doProfissional =
    profissionalId === null ? Prisma.empty : Prisma.sql`AND r.profissional_id = ${profissionalId}::uuid`;
  return Prisma.sql`
    SELECT r.id::text AS id, r.profissional_id::text AS profissional_id, p.nome AS profissional_nome,
           r.inicio, r.fim, c.nome AS cliente_nome, count(*) OVER () AS total
      FROM reserva r
      JOIN profissional p ON p.salao_id = r.salao_id AND p.id = r.profissional_id
      JOIN cliente c ON c.salao_id = r.salao_id AND c.id = r.cliente_id
     WHERE r.salao_id = ${salaoId}::uuid
       AND r.status = 'confirmado'
       AND tstzrange(r.inicio, r.ocupado_ate, '[)') && tstzrange(${de}::timestamptz, ${ate}::timestamptz, '[)')
       AND r.inicio < ${ate}::timestamptz AND r.fim > ${de}::timestamptz
       ${doProfissional}
     ORDER BY r.inicio, r.id
     LIMIT ${limite}::int`;
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

    async criar(ctx, d) {
      const salaoId = exigirEscopo(ctx);
      const linhas = await db.$queryRaw<{ id: string }[]>`
        INSERT INTO reserva (salao_id, profissional_id, cliente_id, inicio, fim, ocupado_ate, status, origem, encaixe, revisao, chave_requisicao)
        VALUES (${salaoId}::uuid, ${d.profissionalId}::uuid, ${d.clienteId}::uuid, ${d.inicio}::timestamptz,
                ${d.fim}::timestamptz, ${d.ocupadoAte}::timestamptz, 'confirmado', ${d.origem}::origem_reserva,
                ${d.encaixe}, 0, ${d.chaveRequisicao})
        ON CONFLICT (salao_id, chave_requisicao) DO NOTHING
        RETURNING id::text AS id`;
      return linhas[0] ? { criada: true, id: linhas[0].id } : { criada: false };
    },

    async criarItens(ctx, reservaId, itens) {
      const salaoId = exigirEscopo(ctx);
      await db.reservaItem.createMany({
        data: itens.map((i) => ({
          salaoId,
          reservaId,
          servicoId: i.servicoId,
          ordem: i.ordem,
          precoCentavos: i.precoCentavos,
          duracaoMin: i.duracaoMin,
        })),
      });
    },

    async buscarPorChave(ctx, chave) {
      const salaoId = exigirEscopo(ctx);
      if (!ehUuid(chave)) {
        return null;
      }
      return db.reserva.findFirst({ where: { salaoId, chaveRequisicao: chave }, select: CAMPOS });
    },

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

    async listarConfirmadasQueCruzam(ctx, periodo, profissionalId, limite) {
      const salaoId = exigirEscopo(ctx);
      if (profissionalId !== null && !ehUuid(profissionalId)) {
        throw new NaoEncontrado();
      }
      if (!Number.isSafeInteger(limite) || limite < 1) {
        throw new RangeError('listarConfirmadasQueCruzam: limite deve ser um inteiro positivo');
      }
      const linhas = await db.$queryRaw<LinhaCoberta[]>(consultaReservasQueCruzam(salaoId, periodo, profissionalId, limite));
      const total = linhas.length === 0 ? 0 : Number(linhas[0].total);
      return {
        total,
        reservas: linhas.map((l) => ({
          id: l.id,
          profissionalId: l.profissional_id,
          profissionalNome: l.profissional_nome,
          inicio: l.inicio,
          fim: l.fim,
          clienteNome: l.cliente_nome,
        })),
      };
    },
  };
}
