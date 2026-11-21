import { Prisma } from '@/generated/prisma/client';
import type { ContextoEscopado } from '@/server/tenant/context';
import { exigirEscopo } from '@/server/tenant/context';
import { NaoEncontrado } from '@/server/tenant/erros';

import { ehUuid } from './ids';
import type { JornadaLinhaDTO, Periodo, StatusReserva, OrigemReserva } from './tipos';
import type { Executor } from './transacao';

// Leituras da agenda da equipe (D-028 §4). Só leitura. Todo método filtra pelo salão do contexto. Uma
// instrução por chamada: profissional, cliente (só o nome e se foi anonimizada; o telefone NUNCA é lido
// aqui) e os itens (agregados em JSON) vêm na mesma consulta, sem N+1 (CA-16).

export type ItemDeLinhaAgenda = { nome: string; precoCentavos: number; duracaoMin: number };

export type LinhaAgenda = {
  id: string;
  profissionalId: string;
  profissionalNome: string;
  profissionalAtivo: boolean;
  clienteId: string;
  clienteNome: string | null;
  clienteAnonimizada: boolean;
  inicio: Date;
  fim: Date;
  status: StatusReserva;
  origem: OrigemReserva;
  encaixe: boolean;
  itens: ItemDeLinhaAgenda[];
};

export interface RepoAgenda {
  /**
   * Reservas de TODOS os status que cruzam [de, ate) (`inicio < ate AND fim > de`), por início e id.
   * `profissionalId` limita a um profissional (malformado → NaoEncontrado sem consultar). Devolve até
   * `limite` linhas; `truncada` indica que havia mais.
   */
  listarAgenda(
    ctx: ContextoEscopado,
    d: { periodo: Periodo; profissionalId: string | null; limite: number },
  ): Promise<{ reservas: LinhaAgenda[]; truncada: boolean }>;
  /** Uma reserva do salão (e, se informado, do profissional). Outra: NaoEncontrado (igual para todos os casos). */
  detalhe(ctx: ContextoEscopado, id: unknown, profissionalId: string | null): Promise<LinhaAgenda>;
  /** Jornada (todas as linhas) do salão ou de um profissional, numa instrução. */
  listarJornadas(ctx: ContextoEscopado, profissionalId: string | null): Promise<(JornadaLinhaDTO & { profissionalId: string })[]>;
}

type LinhaBruta = {
  id: string;
  profissional_id: string;
  profissional_nome: string;
  profissional_ativo: boolean;
  cliente_id: string;
  cliente_nome: string | null;
  cliente_anonimizada: boolean;
  inicio: Date;
  fim: Date;
  status: StatusReserva;
  origem: OrigemReserva;
  encaixe: boolean;
  itens: { nome: string; preco: number; duracao: number }[];
};

const COLUNAS = Prisma.sql`
  r.id::text AS id, r.profissional_id::text AS profissional_id, p.nome AS profissional_nome,
  p.ativo AS profissional_ativo, r.cliente_id::text AS cliente_id, c.nome AS cliente_nome,
  (c.anonimizada_em IS NOT NULL) AS cliente_anonimizada, r.inicio, r.fim,
  r.status::text AS status, r.origem::text AS origem, r.encaixe,
  COALESCE((SELECT json_agg(json_build_object('nome', s.nome, 'preco', ri.preco_centavos, 'duracao', ri.duracao_min)
                            ORDER BY ri.ordem)
              FROM reserva_item ri
              JOIN servico s ON s.salao_id = ri.salao_id AND s.id = ri.servico_id
             WHERE ri.salao_id = r.salao_id AND ri.reserva_id = r.id), '[]'::json) AS itens`;

const DE = Prisma.sql`
  FROM reserva r
  JOIN profissional p ON p.salao_id = r.salao_id AND p.id = r.profissional_id
  JOIN cliente c ON c.salao_id = r.salao_id AND c.id = r.cliente_id`;

/** Margem para o limite inferior de `inicio` (D-028 §4): 10 serviços × 720 min = 5 dias < 7 dias. */
const MARGEM_INICIO = Prisma.sql`interval '7 days'`;

/**
 * SQL da listagem (exportado só para o teste de plano). O predicado `r.inicio >= de - 7 dias` é
 * redundante para o resultado (nenhuma reserva dura mais que 5 dias) e existe para o planejador usar
 * `reserva_salao_id_inicio_idx`/`reserva_salao_id_profissional_id_inicio_idx` sem varrer o histórico.
 */
export function consultaAgenda(
  salaoId: string,
  { de, ate }: Periodo,
  profissionalId: string | null,
  limite: number,
): Prisma.Sql {
  const doProfissional =
    profissionalId === null ? Prisma.empty : Prisma.sql`AND r.profissional_id = ${profissionalId}::uuid`;
  return Prisma.sql`
    SELECT ${COLUNAS}
      ${DE}
     WHERE r.salao_id = ${salaoId}::uuid
       AND r.inicio < ${ate}::timestamptz AND r.fim > ${de}::timestamptz
       AND r.inicio >= ${de}::timestamptz - ${MARGEM_INICIO}
       ${doProfissional}
     ORDER BY r.inicio, r.id
     LIMIT ${limite}::int`;
}

function deLinha(l: LinhaBruta): LinhaAgenda {
  return {
    id: l.id,
    profissionalId: l.profissional_id,
    profissionalNome: l.profissional_nome,
    profissionalAtivo: l.profissional_ativo,
    clienteId: l.cliente_id,
    clienteNome: l.cliente_anonimizada ? null : l.cliente_nome,
    clienteAnonimizada: l.cliente_anonimizada,
    inicio: l.inicio,
    fim: l.fim,
    status: l.status,
    origem: l.origem,
    encaixe: l.encaixe,
    itens: l.itens.map((i) => ({ nome: i.nome, precoCentavos: i.preco, duracaoMin: i.duracao })),
  };
}

export function criarRepoAgenda(db: Executor): RepoAgenda {
  return {
    async listarAgenda(ctx, { periodo, profissionalId, limite }) {
      const salaoId = exigirEscopo(ctx);
      if (profissionalId !== null && !ehUuid(profissionalId)) {
        throw new NaoEncontrado();
      }
      if (!Number.isSafeInteger(limite) || limite < 1) {
        throw new RangeError('listarAgenda: limite deve ser um inteiro positivo');
      }
      const linhas = await db.$queryRaw<LinhaBruta[]>(consultaAgenda(salaoId, periodo, profissionalId, limite + 1));
      return { reservas: linhas.slice(0, limite).map(deLinha), truncada: linhas.length > limite };
    },

    async detalhe(ctx, id, profissionalId) {
      const salaoId = exigirEscopo(ctx);
      if (!ehUuid(id) || (profissionalId !== null && !ehUuid(profissionalId))) {
        throw new NaoEncontrado();
      }
      const doProfissional =
        profissionalId === null ? Prisma.empty : Prisma.sql`AND r.profissional_id = ${profissionalId}::uuid`;
      const linhas = await db.$queryRaw<LinhaBruta[]>(Prisma.sql`
        SELECT ${COLUNAS}
          ${DE}
         WHERE r.salao_id = ${salaoId}::uuid AND r.id = ${id}::uuid ${doProfissional}`);
      if (linhas.length === 0) {
        throw new NaoEncontrado();
      }
      return deLinha(linhas[0]);
    },

    async listarJornadas(ctx, profissionalId) {
      const salaoId = exigirEscopo(ctx);
      if (profissionalId !== null && !ehUuid(profissionalId)) {
        throw new NaoEncontrado();
      }
      return db.jornada.findMany({
        where: { salaoId, ...(profissionalId !== null && { profissionalId }) },
        select: { id: true, profissionalId: true, diaSemana: true, inicioMin: true, fimMin: true },
        orderBy: [{ profissionalId: 'asc' }, { diaSemana: 'asc' }, { inicioMin: 'asc' }, { id: 'asc' }],
      });
    },
  };
}
