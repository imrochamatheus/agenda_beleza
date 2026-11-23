import { Prisma } from '@/generated/prisma/client';
import type { ContextoEscopado } from '@/server/tenant/context';
import { exigirEscopo } from '@/server/tenant/context';
import { NaoEncontrado } from '@/server/tenant/erros';

import { ehUuid } from './ids';
import type { Periodo, ReservaBloqueanteDTO, ReservaCobertaDTO, ReservaDTO } from './tipos';
import type { Executor } from './transacao';

/** D-050 §3.3: a reserva nasce sem profissional, ocupação nem encaixe (são do item). */
export type NovaReserva = {
  clienteId: string;
  origem: 'publico' | 'equipe';
  chaveRequisicao: string | null;
  /** Envelope dos itens (`envelope()` de reservas/itens.ts). */
  inicio: Date;
  fim: Date;
};

/**
 * Item a gravar (D-050 §3.3). `fim = inicio + duracaoMin` (reserva_item_fim_chk) e `ocupadoAte = fim +
 * intervalo do salão` vêm calculados pela aplicação; preço e duração são o snapshot do serviço travado.
 */
export type NovoItemDeReserva = {
  servicoId: string;
  profissionalId: string;
  ordem: number;
  inicio: Date;
  fim: Date;
  ocupadoAte: Date;
  precoCentavos: number;
  duracaoMin: number;
  encaixe: boolean;
};

export interface RepoReserva {
  /**
   * D-025 A-5 / D-050 §3.3: INSERT de uma reserva `confirmado`, revisão 0, com o envelope dos itens e
   * `ON CONFLICT (salao_id, chave_requisicao) DO NOTHING RETURNING id`: `criada: false` = outra
   * requisição com a mesma chave já a gravou (o PostgreSQL espera o commit dela). O literal
   * 'confirmado' fica no texto. Os itens vêm depois, por `criarItens`, na mesma transação.
   */
  criar(ctx: ContextoEscopado, d: NovaReserva): Promise<{ criada: true; id: string } | { criada: false }>;
  /**
   * D-050 §3.3: UM `INSERT … SELECT FROM unnest(…)` com todos os itens, status 'confirmado' LITERAL e
   * revisão 0. Devolve id e ordem de cada item (ordem crescente). Pode lançar o 23P01 de
   * `reserva_item_sem_sobreposicao`: NÃO o captura (o serviço o traduz fora da transação). Lista vazia
   * → RangeError sem consultar. Junto com repos/reserva-alteracao.ts, é o ÚNICO escritor de
   * `reserva_item` no código de produção (dba.md Q1).
   */
  criarItens(ctx: ContextoEscopado, reservaId: string, itens: readonly NovoItemDeReserva[]): Promise<{ id: string; ordem: number }[]>;
  /**
   * D-027 (E4.2) / D-050 RN-18: quantas reservas a cliente tem neste salão com status derivado
   * `confirmado` E algum item `confirmado` com `inicio > agora`, ignorando a de `ignorarChave` (a mesma
   * requisição). Os literais 'confirmado' ficam no texto (índice parcial `reserva_cliente_confirmada_idx`;
   * dba.md Q5). Cliente de outro salão ou inexistente → 0.
   */
  contarFuturasDaCliente(
    ctx: ContextoEscopado,
    d: { clienteId: string; agora: Date; ignorarChave: string | null },
  ): Promise<number>;
  /** Reserva do salão com a chave (índice UNIQUE); chave não UUID → null sem consultar. */
  buscarPorChave(ctx: ContextoEscopado, chave: string): Promise<ReservaDTO | null>;
  /** Reserva com os itens por (inicio, id). Malformado, inexistente ou de outro salão → NaoEncontrado. */
  buscarPorId(ctx: ContextoEscopado, id: string): Promise<ReservaDTO>;
  /** Reservas com o envelope `inicio` em [de, ate), por (inicio, id) (índice (salao_id, inicio)). */
  listarPorPeriodo(ctx: ContextoEscopado, periodo: Periodo): Promise<ReservaDTO[]>;
  /**
   * ITENS que impedem desativar o profissional (D-013 RN-2, D-1; D-050 RN-38): item do profissional
   * com `status = 'confirmado'` e `fim > agora` (inclui o em andamento), no salão do contexto; uma
   * linha por item. Ordem: inicio, id do item. Traz o nome da cliente (null se anonimizada; o telefone
   * nunca é lido) e o nome atual do serviço do item. ID malformado → NaoEncontrado sem consultar.
   */
  listarBloqueantesDeDesativacao(
    ctx: ContextoEscopado,
    profissionalId: string,
    agora: Date,
  ): Promise<ReservaBloqueanteDTO[]>;
  /**
   * ITENS sob um bloqueio (D-016 RN-8; D-050 RN-38): item `confirmado` com [inicio, fim) && [de, ate)
   * (sem ocupado_ate, spec D-7), no salão do contexto; `profissionalId` → só dele; null → de todos os
   * profissionais do salão. Ordem: inicio, id do item. No máximo `limite`; `total` é a contagem completa.
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
  item_id: string;
  profissional_id: string;
  profissional_nome: string;
  inicio: Date;
  fim: Date;
  cliente_nome: string | null;
  total: bigint;
};

/**
 * SQL de listarConfirmadasQueCruzam (exportado só para o teste de plano, D-016 R-3; D-050 dba.md Q8),
 * sobre `reserva_item`. O literal 'confirmado' e o predicado redundante
 * `tstzrange(i.inicio, i.ocupado_ate, '[)') && …` ficam NO TEXTO para o planejador provar a implicação
 * com o predicado do índice parcial `reserva_item_sem_sobreposicao` (GiST da exclusion) e usá-lo,
 * inclusive com plano genérico. NÃO troque o literal por parâmetro nem junte as duas variantes num
 * `$p IS NULL OR …` (o plano perde o índice). O filtro exato `i.inicio < ate AND i.fim > de` vem junto,
 * porque [inicio, ocupado_ate) é um superconjunto. Seleciona c.nome e nunca c.telefone_e164.
 */
export function consultaReservasQueCruzam(
  salaoId: string,
  { de, ate }: Periodo,
  profissionalId: string | null,
  limite: number,
): Prisma.Sql {
  const doProfissional =
    profissionalId === null ? Prisma.empty : Prisma.sql`AND i.profissional_id = ${profissionalId}::uuid`;
  return Prisma.sql`
    SELECT i.reserva_id::text AS id, i.id::text AS item_id, i.profissional_id::text AS profissional_id,
           p.nome AS profissional_nome, i.inicio, i.fim, c.nome AS cliente_nome, count(*) OVER () AS total
      FROM reserva_item i
      JOIN reserva r ON r.salao_id = i.salao_id AND r.id = i.reserva_id
      JOIN profissional p ON p.salao_id = i.salao_id AND p.id = i.profissional_id
      JOIN cliente c ON c.salao_id = r.salao_id AND c.id = r.cliente_id
     WHERE i.salao_id = ${salaoId}::uuid
       AND i.status = 'confirmado'
       AND tstzrange(i.inicio, i.ocupado_ate, '[)') && tstzrange(${de}::timestamptz, ${ate}::timestamptz, '[)')
       AND i.inicio < ${ate}::timestamptz AND i.fim > ${de}::timestamptz
       ${doProfissional}
     ORDER BY i.inicio, i.id
     LIMIT ${limite}::int`;
}

const CAMPOS_ITEM = {
  id: true,
  servicoId: true,
  profissionalId: true,
  ordem: true,
  inicio: true,
  fim: true,
  ocupadoAte: true,
  status: true,
  encaixe: true,
  revisao: true,
  precoCentavos: true,
  duracaoMin: true,
} as const;

const CAMPOS = {
  id: true,
  clienteId: true,
  inicio: true,
  fim: true,
  status: true,
  origem: true,
  revisao: true,
  canceladaEm: true,
  itens: { select: CAMPOS_ITEM, orderBy: [{ inicio: 'asc' }, { id: 'asc' }] },
} as const satisfies Prisma.ReservaSelect;

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
        INSERT INTO reserva (salao_id, cliente_id, inicio, fim, status, origem, revisao, chave_requisicao)
        VALUES (${salaoId}::uuid, ${d.clienteId}::uuid, ${d.inicio}::timestamptz, ${d.fim}::timestamptz,
                'confirmado', ${d.origem}::origem_reserva, 0, ${d.chaveRequisicao})
        ON CONFLICT (salao_id, chave_requisicao) DO NOTHING
        RETURNING id::text AS id`;
      return linhas[0] ? { criada: true, id: linhas[0].id } : { criada: false };
    },

    async contarFuturasDaCliente(ctx, { clienteId, agora, ignorarChave }) {
      const salaoId = exigirEscopo(ctx);
      if (!ehUuid(clienteId)) return 0;
      const [linha] = await db.$queryRaw<{ total: bigint }[]>`
        SELECT count(*) AS total FROM reserva r
         WHERE r.salao_id = ${salaoId}::uuid AND r.cliente_id = ${clienteId}::uuid AND r.status = 'confirmado'
           AND (r.chave_requisicao IS DISTINCT FROM ${ignorarChave}::text OR ${ignorarChave}::text IS NULL)
           AND EXISTS (SELECT 1 FROM reserva_item i
                        WHERE i.salao_id = r.salao_id AND i.reserva_id = r.id
                          AND i.status = 'confirmado' AND i.inicio > ${agora}::timestamptz)`;
      return Number(linha.total);
    },

    async criarItens(ctx, reservaId, itens) {
      const salaoId = exigirEscopo(ctx);
      if (itens.length === 0) {
        throw new RangeError('criarItens: a reserva precisa de ao menos um item');
      }
      const linhas = await db.$queryRaw<{ id: string; ordem: number }[]>`
        INSERT INTO reserva_item (salao_id, reserva_id, servico_id, profissional_id, ordem, inicio, fim, ocupado_ate,
                                  status, encaixe, revisao, preco_centavos, duracao_min)
        SELECT ${salaoId}::uuid, ${reservaId}::uuid, x.servico_id, x.profissional_id, x.ordem, x.inicio, x.fim,
               x.ocupado_ate, 'confirmado', x.encaixe, 0, x.preco_centavos, x.duracao_min
          FROM unnest(${itens.map((i) => i.servicoId)}::uuid[], ${itens.map((i) => i.profissionalId)}::uuid[],
                      ${itens.map((i) => i.ordem)}::int[], ${itens.map((i) => i.inicio.toISOString())}::timestamptz[],
                      ${itens.map((i) => i.fim.toISOString())}::timestamptz[],
                      ${itens.map((i) => i.ocupadoAte.toISOString())}::timestamptz[],
                      ${itens.map((i) => i.encaixe)}::boolean[], ${itens.map((i) => i.precoCentavos)}::int[],
                      ${itens.map((i) => i.duracaoMin)}::int[])
               AS x(servico_id, profissional_id, ordem, inicio, fim, ocupado_ate, encaixe, preco_centavos, duracao_min)
        RETURNING id::text AS id, ordem::int AS ordem`;
      return [...linhas].sort((a, b) => a.ordem - b.ordem);
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

    async listarBloqueantesDeDesativacao(ctx, profissionalId, agora) {
      const salaoId = exigirEscopo(ctx);
      if (!ehUuid(profissionalId)) {
        throw new NaoEncontrado();
      }
      const linhas = await db.reservaItem.findMany({
        where: { salaoId, profissionalId, status: 'confirmado', fim: { gt: agora } },
        select: {
          id: true,
          reservaId: true,
          inicio: true,
          fim: true,
          servico: { select: { nome: true } },
          reserva: { select: { cliente: { select: { nome: true } } } },
        },
        orderBy: [{ inicio: 'asc' }, { id: 'asc' }],
      });
      return linhas.map((i) => ({
        id: i.reservaId,
        itemId: i.id,
        inicio: i.inicio,
        fim: i.fim,
        clienteNome: i.reserva.cliente.nome,
        servicos: [i.servico.nome],
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
          itemId: l.item_id,
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
