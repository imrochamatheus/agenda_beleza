import { ehTelefoneBrE164 } from '@/lib/telefone';
import type { ContextoEscopado } from '@/server/tenant/context';
import { exigirEscopo } from '@/server/tenant/context';
import { NaoEncontrado } from '@/server/tenant/erros';

import { ehUuid } from './ids';
import type { ClienteDTO, ReservaHistoricoDTO } from './tipos';
import type { Executor } from './transacao';

// Travas e ordem canônica (D-022 A-6), obrigação das E3.x: `salao` (só quando a operação precisar de
// FOR SHARE/NO KEY UPDATE dele, SEMPRE PRIMEIRO) → profissional(is) → serviço(s) → CLIENTE →
// servico_profissional/jornada/reserva/reserva_item. `upsert` é um único INSERT … ON CONFLICT (toma a
// linha da cliente como NO KEY UPDATE quando já existe) e roda dentro da ordem do chamador. `atualizar`
// roda dentro de uma transação do serviço que já travou o salão (`saloes.travar`) e então a linha da
// cliente FOR UPDATE (o telefone é coluna de chave). `anonimizar` (D-031) segue a mesma ordem e é seguida,
// na mesma transação, por RepoMensagem.anonimizarDaCliente (mensagem → mensagem_tentativa, por último). Nunca capturar erros aqui: a captura do 23505 da
// edição × upsert é do serviço, fora da transação.

/** DTO de ClienteDTO a partir de uma linha bruta (snake_case). */
type LinhaCliente = {
  id: string;
  nome: string | null;
  telefone_e164: string | null;
  anonimizada_em: Date | null;
  criado_em: Date;
  atualizado_em: Date;
};

const paraDTO = (l: LinhaCliente): ClienteDTO => ({
  id: l.id,
  nome: l.nome,
  telefoneE164: l.telefone_e164,
  anonimizadaEm: l.anonimizada_em,
  criadoEm: l.criado_em,
  atualizadoEm: l.atualizado_em,
});

export type ResultadoAtualizarCliente =
  | { resultado: 'ok'; cliente: ClienteDTO; alterada: boolean }
  | { resultado: 'em_uso'; existente: { id: string; nome: string } };

export type ResultadoAnonimizarCliente = { resultado: 'ok'; cliente: ClienteDTO } | { resultado: 'ja_anonimizada' };

export interface RepoCliente {
  /** Inclui anonimizadas (nome e telefone nulos), RN-16. */
  buscarPorId(ctx: ContextoEscopado, id: string): Promise<ClienteDTO>;
  /** Inclui anonimizadas; ordem de cadastro. */
  listar(ctx: ContextoEscopado): Promise<ClienteDTO[]>;
  /** Só cliente não anonimizada: anonimizada responde NaoEncontrado. */
  renomear(ctx: ContextoEscopado, id: string, nome: string): Promise<ClienteDTO>;
  /**
   * ÚNICO ponto de criação (D-022 RN-6): `INSERT … ON CONFLICT (salao_id, telefone_e164) DO UPDATE`
   * numa instrução; grava sempre o nome e `atualizado_em`. `criada` vem de `xmax = 0`. Recebe valores
   * JÁ normalizados (o telefone é conferido: fora do E.164 brasileiro → RangeError, antes do banco).
   */
  upsert(
    ctx: ContextoEscopado,
    v: { nome: string; telefoneE164: string },
  ): Promise<{ cliente: { id: string; nome: string; telefoneE164: string }; criada: boolean }>;
  /**
   * Lista paginada (20) das NÃO anonimizadas do salão num só comando, com o total. `nome` é a chave de
   * busca já normalizada ('' = tudo); `digitos` ativa o critério do telefone (null = desligado).
   * Ordem: nome normalizado (collation C) e id.
   */
  buscar(
    ctx: ContextoEscopado,
    p: { nome: string; digitos: string | null; pagina: number },
  ): Promise<{ itens: ClienteDTO[]; total: number }>;
  /**
   * Edição sob trava (dentro de emTransacao, depois de `saloes.travar`): SELECT … FOR UPDATE da linha
   * (não anonimizada, do salão; senão NaoEncontrado), compara, pré-checa o telefone e faz o UPDATE.
   * Nada mudou → não escreve (`alterada: false`). Telefone de outra cliente → `em_uso`.
   */
  atualizar(ctx: ContextoEscopado, id: string, v: { nome: string; telefoneE164: string }): Promise<ResultadoAtualizarCliente>;
  /**
   * Dono do telefone no salão (não anonimizada) ou null. Usado pela releitura depois de uma edição
   * que perdeu a corrida contra um upsert (23505), fora da transação desfeita.
   */
  buscarPorTelefone(ctx: ContextoEscopado, telefoneE164: string): Promise<{ id: string; nome: string } | null>;
  /**
   * Anonimização (D-031, dentro de emTransacao, depois de `saloes.travar`): SELECT … FOR UPDATE da linha
   * (inclui anonimizadas; id malformado, inexistente ou de outro salão → NaoEncontrado), já anonimizada →
   * `ja_anonimizada` sem escrever; senão UM UPDATE de nome, telefone e `anonimizada_em` (o CHECK exige o par).
   */
  anonimizar(ctx: ContextoEscopado, id: string, agora: Date): Promise<ResultadoAnonimizarCliente>;
  /** Até `limite` reservas da cliente, da mais recente à mais antiga, com o total. */
  historico(
    ctx: ContextoEscopado,
    clienteId: string,
    limite: number,
  ): Promise<{ reservas: ReservaHistoricoDTO[]; total: number }>;
  /**
   * Cliente (inclui anonimizada) do salão; com `so.profissionalId`, só se houver reserva (qualquer
   * status) dela com esse profissional. NaoEncontrado não distingue os motivos.
   */
  buscarContato(ctx: ContextoEscopado, id: string, so?: { profissionalId: string }): Promise<ClienteDTO>;
}

/** Tamanho da página da lista (LIMITES_CLIENTE.porPagina). */
const LIMITE_PAGINA = 20;

const CAMPOS = {
  id: true,
  nome: true,
  telefoneE164: true,
  anonimizadaEm: true,
  criadoEm: true,
  atualizadoEm: true,
} as const;

export function criarRepoCliente(db: Executor): RepoCliente {
  async function buscarPorId(ctx: ContextoEscopado, id: string): Promise<ClienteDTO> {
    const salaoId = exigirEscopo(ctx);
    if (!ehUuid(id)) {
      throw new NaoEncontrado();
    }
    const cliente = await db.cliente.findFirst({ where: { id, salaoId }, select: CAMPOS });
    if (!cliente) {
      throw new NaoEncontrado();
    }
    return cliente;
  }

  return {
    buscarPorId,

    async listar(ctx) {
      const salaoId = exigirEscopo(ctx);
      return db.cliente.findMany({
        where: { salaoId },
        select: CAMPOS,
        orderBy: [{ criadoEm: 'asc' }, { id: 'asc' }],
      });
    },

    async renomear(ctx, id, nome) {
      const salaoId = exigirEscopo(ctx);
      if (!ehUuid(id)) {
        throw new NaoEncontrado();
      }
      const { count } = await db.cliente.updateMany({
        where: { id, salaoId, anonimizadaEm: null },
        data: { nome },
      });
      if (count === 0) {
        throw new NaoEncontrado();
      }
      return buscarPorId(ctx, id);
    },

    async upsert(ctx, v) {
      const salaoId = exigirEscopo(ctx);
      if (!ehTelefoneBrE164(v.telefoneE164)) {
        throw new RangeError('upsert: telefone fora do E.164 brasileiro');
      }
      const linhas = await db.$queryRaw<{ id: string; nome: string; telefone_e164: string; criada: boolean }[]>`
        INSERT INTO cliente (salao_id, nome, telefone_e164)
        VALUES (${salaoId}::uuid, ${v.nome}, ${v.telefoneE164})
        ON CONFLICT (salao_id, telefone_e164)
        DO UPDATE SET nome = EXCLUDED.nome, atualizado_em = now()
        RETURNING id, nome, telefone_e164, (xmax = 0) AS criada`;
      const l = linhas[0];
      return { cliente: { id: l.id, nome: l.nome, telefoneE164: l.telefone_e164 }, criada: l.criada };
    },

    async buscar(ctx, p) {
      const salaoId = exigirEscopo(ctx);
      const deslocamento = (Math.max(1, Math.trunc(p.pagina)) - 1) * LIMITE_PAGINA;
      // `position(texto IN …)` é literal: %, _ e \ não precisam de escape. A regex é a MESMA de
      // chaveDeBusca (U+0300..U+036F). O comando sempre devolve uma linha com o total (página vazia
      // → colunas da cliente nulas).
      const linhas = await db.$queryRaw<(Partial<LinhaCliente> & { total: number })[]>`
        WITH f AS (
          SELECT id, nome, telefone_e164, anonimizada_em, criado_em, atualizado_em,
                 lower(regexp_replace(normalize(nome, NFD), '[\\u0300-\\u036f]', '', 'g')) AS chave
            FROM cliente
           WHERE salao_id = ${salaoId}::uuid AND anonimizada_em IS NULL
        ), g AS (
          SELECT * FROM f
           WHERE ${p.nome}::text = ''
              OR position(${p.nome}::text IN chave) > 0
              OR (${p.digitos}::text IS NOT NULL AND position(${p.digitos}::text IN substr(telefone_e164, 2)) > 0)
        )
        SELECT (SELECT count(*) FROM g)::int AS total, pg.id, pg.nome, pg.telefone_e164, pg.anonimizada_em,
               pg.criado_em, pg.atualizado_em
          FROM (SELECT 1) d
          LEFT JOIN (SELECT * FROM g ORDER BY chave COLLATE "C", id LIMIT ${LIMITE_PAGINA}::int OFFSET ${deslocamento}::bigint) pg ON true`;
      const total = Number(linhas[0]?.total ?? 0);
      const itens = linhas.filter((l) => l.id !== null && l.id !== undefined).map((l) => paraDTO(l as LinhaCliente));
      return { itens, total };
    },

    async atualizar(ctx, id, v) {
      const salaoId = exigirEscopo(ctx);
      if (!ehUuid(id)) {
        throw new NaoEncontrado();
      }
      if (!ehTelefoneBrE164(v.telefoneE164)) {
        throw new RangeError('atualizar: telefone fora do E.164 brasileiro');
      }
      const atuais = await db.$queryRaw<LinhaCliente[]>`
        SELECT id, nome, telefone_e164, anonimizada_em, criado_em, atualizado_em
          FROM cliente
         WHERE id = ${id}::uuid AND salao_id = ${salaoId}::uuid AND anonimizada_em IS NULL
           FOR UPDATE`;
      const atual = atuais[0];
      if (!atual) {
        throw new NaoEncontrado();
      }
      if (atual.nome === v.nome && atual.telefone_e164 === v.telefoneE164) {
        return { resultado: 'ok', cliente: paraDTO(atual), alterada: false };
      }
      if (atual.telefone_e164 !== v.telefoneE164) {
        const outras = await db.$queryRaw<{ id: string; nome: string | null }[]>`
          SELECT id, nome FROM cliente
           WHERE salao_id = ${salaoId}::uuid AND telefone_e164 = ${v.telefoneE164} AND id <> ${id}::uuid`;
        const outra = outras[0];
        if (outra) {
          return { resultado: 'em_uso', existente: { id: outra.id, nome: outra.nome ?? '' } };
        }
      }
      const gravadas = await db.$queryRaw<LinhaCliente[]>`
        UPDATE cliente SET nome = ${v.nome}, telefone_e164 = ${v.telefoneE164}, atualizado_em = now()
         WHERE id = ${id}::uuid AND salao_id = ${salaoId}::uuid
        RETURNING id, nome, telefone_e164, anonimizada_em, criado_em, atualizado_em`;
      return { resultado: 'ok', cliente: paraDTO(gravadas[0]), alterada: true };
    },

    async anonimizar(ctx, id, agora) {
      const salaoId = exigirEscopo(ctx);
      if (!ehUuid(id)) {
        throw new NaoEncontrado();
      }
      const atuais = await db.$queryRaw<{ id: string; anonimizada_em: Date | null }[]>`
        SELECT id, anonimizada_em FROM cliente
         WHERE id = ${id}::uuid AND salao_id = ${salaoId}::uuid
           FOR UPDATE`;
      if (atuais.length === 0) {
        throw new NaoEncontrado();
      }
      if (atuais[0].anonimizada_em !== null) {
        return { resultado: 'ja_anonimizada' };
      }
      const gravadas = await db.$queryRaw<LinhaCliente[]>`
        UPDATE cliente
           SET nome = NULL, telefone_e164 = NULL, anonimizada_em = ${agora}::timestamptz,
               atualizado_em = ${agora}::timestamptz
         WHERE id = ${id}::uuid AND salao_id = ${salaoId}::uuid
        RETURNING id, nome, telefone_e164, anonimizada_em, criado_em, atualizado_em`;
      return { resultado: 'ok', cliente: paraDTO(gravadas[0]) };
    },

    async buscarPorTelefone(ctx, telefoneE164) {
      const salaoId = exigirEscopo(ctx);
      const c = await db.cliente.findFirst({ where: { salaoId, telefoneE164 }, select: { id: true, nome: true } });
      return c && c.nome !== null ? { id: c.id, nome: c.nome } : null;
    },

    async historico(ctx, clienteId, limite) {
      const salaoId = exigirEscopo(ctx);
      if (!ehUuid(clienteId)) {
        throw new NaoEncontrado();
      }
      if (!Number.isSafeInteger(limite) || limite < 1) {
        throw new RangeError('historico: limite deve ser um inteiro positivo');
      }
      const where = { salaoId, clienteId };
      const [linhas, total] = await Promise.all([
        db.reserva.findMany({
          where,
          select: {
            id: true,
            inicio: true,
            status: true,
            profissional: { select: { nome: true } },
            itens: {
              select: { ordem: true, precoCentavos: true, duracaoMin: true, servico: { select: { nome: true } } },
              orderBy: { ordem: 'asc' },
            },
          },
          orderBy: [{ inicio: 'desc' }, { id: 'asc' }],
          take: limite,
        }),
        db.reserva.count({ where }),
      ]);
      return {
        total,
        reservas: linhas.map((r) => ({
          id: r.id,
          inicio: r.inicio,
          status: r.status,
          profissionalNome: r.profissional.nome,
          itens: r.itens.map((i) => ({
            servicoNome: i.servico.nome,
            ordem: i.ordem,
            precoCentavos: i.precoCentavos,
            duracaoMin: i.duracaoMin,
          })),
        })),
      };
    },

    async buscarContato(ctx, id, so) {
      const salaoId = exigirEscopo(ctx);
      if (!ehUuid(id) || (so !== undefined && !ehUuid(so.profissionalId))) {
        throw new NaoEncontrado();
      }
      const cliente = await db.cliente.findFirst({
        where: {
          id,
          salaoId,
          ...(so ? { reservas: { some: { salaoId, profissionalId: so.profissionalId } } } : {}),
        },
        select: CAMPOS,
      });
      if (!cliente) {
        throw new NaoEncontrado();
      }
      return cliente;
    },
  };
}
