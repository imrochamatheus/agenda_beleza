import { Prisma } from '@/generated/prisma/client';
import type { ContextoEscopado } from '@/server/tenant/context';
import { exigirEscopo } from '@/server/tenant/context';
import { NaoEncontrado } from '@/server/tenant/erros';

import { ehUuid } from './ids';
import { PREDICADO_VIGENTE } from './mensagem';
import type { JornadaLinhaDTO, Periodo, StatusReserva, OrigemReserva } from './tipos';
import type { Executor } from './transacao';

// Leituras da agenda da equipe (D-028 §4; D-050 §3.9). Só leitura. Todo método filtra pelo salão do
// contexto. Uma instrução por chamada: profissional, serviço, cliente (só o nome e se foi anonimizada; o
// telefone NUNCA é lido aqui) vêm na mesma consulta, sem N+1 (D-028 CA-16).
// D-050: a unidade da agenda é o ITEM (`reserva_item`): um bloco por item, no profissional do item.
// D-043/RN-37: o EXISTS da falha de mensagem vigente usa `PREDICADO_VIGENTE` de repos/mensagem.ts (fonte
// ÚNICA, nunca copiada; aliases fixos `m` e `r`) e vale para a reserva inteira (todos os blocos dela).
// Os literais ('falhou', status, tipos) nunca são parâmetros.

/** Um item (bloco) na listagem. */
export type LinhaAgenda = {
  itemId: string;
  reservaId: string;
  profissionalId: string;
  clienteNome: string | null;
  clienteAnonimizada: boolean;
  /** Do item. */
  inicio: Date;
  fim: Date;
  status: StatusReserva;
  origem: OrigemReserva;
  encaixe: boolean;
  servicoNome: string;
  precoCentavos: number;
  duracaoMin: number;
  /** Há mensagem `falhou` VIGENTE na reserva (`PREDICADO_VIGENTE`). */
  temFalhaDeMensagem: boolean;
  /** "n de N" entre os itens não cancelados da reserva (só com `comPosicao`; null caso contrário). */
  posicao: { n: number; de: number } | null;
};

export type ItemDoDetalheDTO = {
  id: string;
  servicoId: string;
  servicoNome: string;
  profissionalId: string;
  profissionalNome: string;
  profissionalAtivo: boolean;
  inicio: Date;
  fim: Date;
  status: StatusReserva;
  encaixe: boolean;
  precoCentavos: number;
  duracaoMin: number;
};

export type DetalheAgendaDTO = {
  id: string;
  clienteId: string;
  clienteNome: string | null;
  clienteAnonimizada: boolean;
  /** Envelope e status DERIVADOS (D-050 A-1/A-2). */
  inicio: Date;
  fim: Date;
  status: StatusReserva;
  origem: OrigemReserva;
  temFalhaDeMensagem: boolean;
  /** Por (inicio, id). Com `profissionalId`, só os itens dele. */
  itens: ItemDoDetalheDTO[];
};

export interface RepoAgenda {
  /**
   * Itens de TODOS os status que cruzam [de, ate) (`i.inicio < ate AND i.fim > de`), por (inicio, id).
   * `profissionalId` limita aos itens de um profissional (malformado → NaoEncontrado sem consultar).
   * `comPosicao` (só o gestor) calcula o "n de N". Devolve até `limite` linhas; `truncada` indica que havia mais.
   */
  listarAgenda(
    ctx: ContextoEscopado,
    d: { periodo: Periodo; profissionalId: string | null; limite: number; comPosicao: boolean },
  ): Promise<{ blocos: LinhaAgenda[]; truncada: boolean }>;
  /**
   * Uma reserva do salão. Com `profissionalId`: só se ela tiver ITEM dele (qualquer status), e só os itens
   * dele são devolvidos (CA-33). Caso contrário: NaoEncontrado (igual para todos os casos).
   */
  detalhe(ctx: ContextoEscopado, id: unknown, profissionalId: string | null): Promise<DetalheAgendaDTO>;
  /** Jornada (todas as linhas) do salão ou de um profissional, numa instrução. */
  listarJornadas(ctx: ContextoEscopado, profissionalId: string | null): Promise<(JornadaLinhaDTO & { profissionalId: string })[]>;
}

type LinhaBruta = {
  item_id: string;
  reserva_id: string;
  profissional_id: string;
  cliente_nome: string | null;
  cliente_anonimizada: boolean;
  inicio: Date;
  fim: Date;
  status: StatusReserva;
  origem: OrigemReserva;
  encaixe: boolean;
  servico_nome: string;
  preco_centavos: number;
  duracao_min: number;
  tem_falha_mensagem: boolean;
  posicao_n: number | null;
  posicao_de: number | null;
};

/** EXISTS da falha vigente da reserva `r` (D-043 + D-050 M-4). Exige o alias `r` (reserva) no FROM. */
const TEM_FALHA = Prisma.sql`EXISTS (SELECT 1 FROM mensagem m
           WHERE m.salao_id = r.salao_id AND m.reserva_id = r.id AND m.estado = 'falhou'
             AND ${PREDICADO_VIGENTE})`;

/** "n de N" (dba.md Q7): subconsultas correlacionadas pelo UNIQUE (salao_id, reserva_id, …) de reserva_item. */
const POSICAO = Prisma.sql`
  (SELECT count(*) FROM reserva_item o
    WHERE o.salao_id = i.salao_id AND o.reserva_id = i.reserva_id AND o.status <> 'cancelado'
      AND (o.inicio, o.id) <= (i.inicio, i.id))::int AS posicao_n,
  (SELECT count(*) FROM reserva_item o
    WHERE o.salao_id = i.salao_id AND o.reserva_id = i.reserva_id AND o.status <> 'cancelado')::int AS posicao_de`;

const SEM_POSICAO = Prisma.sql`NULL::int AS posicao_n, NULL::int AS posicao_de`;

/**
 * Margem do limite inferior de `i.inicio` (D-050 M-2): nenhum item dura mais que 1440 min
 * (`reserva_item_duracao_teto_chk`), logo todo item que cruza [de, ate) começa em `de - 1 dia` ou depois.
 */
const MARGEM_INICIO = Prisma.sql`interval '1 day'`;

/**
 * SQL da listagem (exportado só para o teste de plano). O predicado `i.inicio >= de - 1 dia` é redundante
 * para o resultado e existe para o planejador usar `reserva_item_salao_id_(profissional_id_)inicio_idx`
 * sem varrer o histórico (dba.md Q4).
 */
export function consultaAgenda(
  salaoId: string,
  { de, ate }: Periodo,
  profissionalId: string | null,
  limite: number,
  comPosicao: boolean,
): Prisma.Sql {
  const doProfissional =
    profissionalId === null ? Prisma.empty : Prisma.sql`AND i.profissional_id = ${profissionalId}::uuid`;
  return Prisma.sql`
    SELECT i.id::text AS item_id, i.reserva_id::text AS reserva_id, i.profissional_id::text AS profissional_id,
           c.nome AS cliente_nome, (c.anonimizada_em IS NOT NULL) AS cliente_anonimizada,
           i.inicio, i.fim, i.status::text AS status, r.origem::text AS origem, i.encaixe,
           s.nome AS servico_nome, i.preco_centavos, i.duracao_min,
           ${TEM_FALHA} AS tem_falha_mensagem,
           ${comPosicao ? POSICAO : SEM_POSICAO}
      FROM reserva_item i
      JOIN reserva r ON r.salao_id = i.salao_id AND r.id = i.reserva_id
      JOIN cliente c ON c.salao_id = r.salao_id AND c.id = r.cliente_id
      JOIN servico s ON s.salao_id = i.salao_id AND s.id = i.servico_id
     WHERE i.salao_id = ${salaoId}::uuid
       AND i.inicio < ${ate}::timestamptz AND i.fim > ${de}::timestamptz
       AND i.inicio >= ${de}::timestamptz - ${MARGEM_INICIO}
       ${doProfissional}
     ORDER BY i.inicio, i.id
     LIMIT ${limite}::int`;
}

function deLinha(l: LinhaBruta): LinhaAgenda {
  const posicao =
    l.posicao_n !== null && l.posicao_de !== null && l.status !== 'cancelado' && l.posicao_de >= 2
      ? { n: l.posicao_n, de: l.posicao_de }
      : null;
  return {
    itemId: l.item_id,
    reservaId: l.reserva_id,
    profissionalId: l.profissional_id,
    clienteNome: l.cliente_anonimizada ? null : l.cliente_nome,
    clienteAnonimizada: l.cliente_anonimizada,
    inicio: l.inicio,
    fim: l.fim,
    status: l.status,
    origem: l.origem,
    encaixe: l.encaixe,
    servicoNome: l.servico_nome,
    precoCentavos: l.preco_centavos,
    duracaoMin: l.duracao_min,
    temFalhaDeMensagem: l.tem_falha_mensagem,
    posicao,
  };
}

type ItemBruto = {
  id: string;
  servico_id: string;
  servico_nome: string;
  profissional_id: string;
  profissional_nome: string;
  profissional_ativo: boolean;
  /** Milissegundos desde a época (número no JSON: sem depender do TimeZone da sessão). */
  inicio_ms: number;
  fim_ms: number;
  status: StatusReserva;
  encaixe: boolean;
  preco: number;
  duracao: number;
};

type DetalheBruto = {
  id: string;
  cliente_id: string;
  cliente_nome: string | null;
  cliente_anonimizada: boolean;
  inicio: Date;
  fim: Date;
  status: StatusReserva;
  origem: OrigemReserva;
  tem_falha_mensagem: boolean;
  itens: ItemBruto[];
};

export function criarRepoAgenda(db: Executor): RepoAgenda {
  return {
    async listarAgenda(ctx, { periodo, profissionalId, limite, comPosicao }) {
      const salaoId = exigirEscopo(ctx);
      if (profissionalId !== null && !ehUuid(profissionalId)) {
        throw new NaoEncontrado();
      }
      if (!Number.isSafeInteger(limite) || limite < 1) {
        throw new RangeError('listarAgenda: limite deve ser um inteiro positivo');
      }
      const linhas = await db.$queryRaw<LinhaBruta[]>(
        consultaAgenda(salaoId, periodo, profissionalId, limite + 1, comPosicao),
      );
      return { blocos: linhas.slice(0, limite).map(deLinha), truncada: linhas.length > limite };
    },

    async detalhe(ctx, id, profissionalId) {
      const salaoId = exigirEscopo(ctx);
      if (!ehUuid(id) || (profissionalId !== null && !ehUuid(profissionalId))) {
        throw new NaoEncontrado();
      }
      const doProfissional =
        profissionalId === null ? Prisma.empty : Prisma.sql`AND i.profissional_id = ${profissionalId}::uuid`;
      const temItemDoProfissional =
        profissionalId === null
          ? Prisma.empty
          : Prisma.sql`AND EXISTS (SELECT 1 FROM reserva_item i
                                    WHERE i.salao_id = r.salao_id AND i.reserva_id = r.id
                                      AND i.profissional_id = ${profissionalId}::uuid)`;
      const linhas = await db.$queryRaw<DetalheBruto[]>(Prisma.sql`
        SELECT r.id::text AS id, r.cliente_id::text AS cliente_id, c.nome AS cliente_nome,
               (c.anonimizada_em IS NOT NULL) AS cliente_anonimizada, r.inicio, r.fim,
               r.status::text AS status, r.origem::text AS origem,
               ${TEM_FALHA} AS tem_falha_mensagem,
               COALESCE((SELECT json_agg(json_build_object(
                                  'id', i.id, 'servico_id', i.servico_id, 'servico_nome', s.nome,
                                  'profissional_id', i.profissional_id, 'profissional_nome', p.nome,
                                  'profissional_ativo', p.ativo,
                                  'inicio_ms', (extract(epoch FROM i.inicio) * 1000)::bigint,
                                  'fim_ms', (extract(epoch FROM i.fim) * 1000)::bigint,
                                  'status', i.status, 'encaixe', i.encaixe,
                                  'preco', i.preco_centavos, 'duracao', i.duracao_min)
                                ORDER BY i.inicio, i.id)
                           FROM reserva_item i
                           JOIN servico s ON s.salao_id = i.salao_id AND s.id = i.servico_id
                           JOIN profissional p ON p.salao_id = i.salao_id AND p.id = i.profissional_id
                          WHERE i.salao_id = r.salao_id AND i.reserva_id = r.id ${doProfissional}), '[]'::json) AS itens
          FROM reserva r
          JOIN cliente c ON c.salao_id = r.salao_id AND c.id = r.cliente_id
         WHERE r.salao_id = ${salaoId}::uuid AND r.id = ${id}::uuid ${temItemDoProfissional}`);
      if (linhas.length === 0) {
        throw new NaoEncontrado();
      }
      const l = linhas[0];
      return {
        id: l.id,
        clienteId: l.cliente_id,
        clienteNome: l.cliente_anonimizada ? null : l.cliente_nome,
        clienteAnonimizada: l.cliente_anonimizada,
        inicio: l.inicio,
        fim: l.fim,
        status: l.status,
        origem: l.origem,
        temFalhaDeMensagem: l.tem_falha_mensagem,
        itens: l.itens.map((i) => ({
          id: i.id,
          servicoId: i.servico_id,
          servicoNome: i.servico_nome,
          profissionalId: i.profissional_id,
          profissionalNome: i.profissional_nome,
          profissionalAtivo: i.profissional_ativo,
          inicio: new Date(Number(i.inicio_ms)),
          fim: new Date(Number(i.fim_ms)),
          status: i.status,
          encaixe: i.encaixe,
          precoCentavos: i.preco,
          duracaoMin: i.duracao,
        })),
      };
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
