import type { ContextoEscopado } from '@/server/tenant/context';
import { exigirEscopo } from '@/server/tenant/context';
import { NaoEncontrado } from '@/server/tenant/erros';

import { ehUuid } from './ids';
import type { BloqueioDTO, DadosBloqueio, FiltroBloqueios, Periodo, ProfissionalAlvoDTO } from './tipos';
import type { Executor } from './transacao';

// Repositório de bloqueios (D-016 §3.3). Todo método filtra pelo salão do contexto; id que não é UUID
// → NaoEncontrado sem consultar. Bloqueio = [inicio, fim) em UTC; profissional_id nulo = salão inteiro.
// Bloqueio é removível (DELETE físico, RN-10) e pode se sobrepor a outros (RN-9).
//
// ORDEM CANÔNICA DE TRAVAS (D-014 §3.2, D-015 D-12, estendida pela D-016):
//   profissional (FOR UPDATE | FOR NO KEY UPDATE | FOR SHARE | FOR KEY SHARE implícito de FK)
//     → servico(s)
//       → servico_profissional / jornada / reserva / reserva_item / bloqueio
// - Criar: só o FOR KEY SHARE implícito do INSERT na linha do profissional (bloqueio de profissional),
//   que serializa com o FOR UPDATE da desativação (D-013) sem ciclo: a desativação não toca bloqueio.
//   A leitura das reservas cobertas não trava.
// - Editar/remover: só `bloqueio FOR UPDATE OF b` (por id e salão); nenhuma outra trava. UPDATE de
//   inicio/fim/motivo (colunas que não são chave) e DELETE não travam `profissional`.
// O marcador "FOR UPDATE OF b" é procurado em pg_stat_activity pelos testes de concorrência: não altere
// o texto sem ajustá-los.

export interface RepoBloqueio {
  /** Fuso IANA do salão do contexto. Sem linha → NaoEncontrado. */
  fusoDoSalao(ctx: ContextoEscopado): Promise<string>;
  /** Profissional do salão (ativo OU inativo, RN-14). NaoEncontrado para outro salão/inexistente/malformado. */
  buscarProfissional(ctx: ContextoEscopado, id: string): Promise<ProfissionalAlvoDTO>;
  /** Todos os profissionais do salão: ativos primeiro, depois nome e id (opções do alvo). */
  listarProfissionais(ctx: ContextoEscopado): Promise<ProfissionalAlvoDTO[]>;
  /** INSERT com o salão do contexto. Devolve o DTO com o profissional. */
  criar(ctx: ContextoEscopado, d: DadosBloqueio): Promise<BloqueioDTO>;
  /** Sem trava (página de edição). NaoEncontrado se não é do salão. */
  buscar(ctx: ContextoEscopado, id: string): Promise<BloqueioDTO>;
  /**
   * SELECT … FROM bloqueio b … FOR UPDATE OF b (+ o profissional, sem trava). Sem linha →
   * NaoEncontrado. Só faz sentido dentro de emTransacao.
   */
  travar(ctx: ContextoEscopado, id: string): Promise<BloqueioDTO>;
  /** Grava inicio, fim e motivo. Nunca altera profissional_id. 0 linhas → NaoEncontrado. */
  atualizarPeriodo(ctx: ContextoEscopado, id: string, d: { inicio: Date; fim: Date; motivo: string | null }): Promise<BloqueioDTO>;
  /** DELETE; 0 linhas → NaoEncontrado. */
  remover(ctx: ContextoEscopado, id: string): Promise<void>;
  /**
   * RN-18: fim > agora; `{ todos }` → salão inteiro + todos os profissionais; `{ profissionalId }` →
   * os dele + os do salão inteiro. Ordem: inicio, id.
   */
  listarVigentes(ctx: ContextoEscopado, agora: Date, filtro: FiltroBloqueios): Promise<BloqueioDTO[]>;
  /**
   * Bloqueios que intersectam [de, ate): tstzrange(b.inicio, b.fim, '[)') && tstzrange(de, ate, '[)')
   * (usa bloqueio_periodo_idx). `profissionalId` → os dele + os do salão inteiro; sem → todos do salão.
   * Ordem: inicio, id.
   */
  listarNoPeriodo(ctx: ContextoEscopado, periodo: Periodo, opcoes?: { profissionalId?: string }): Promise<BloqueioDTO[]>;
}

const CAMPOS = {
  id: true,
  profissionalId: true,
  inicio: true,
  fim: true,
  motivo: true,
  profissional: { select: { id: true, nome: true, ativo: true } },
} as const;

const ORDEM = [{ inicio: 'asc' }, { id: 'asc' }] as const;

type LinhaBruta = {
  id: string;
  profissional_id: string | null;
  inicio: Date;
  fim: Date;
  motivo: string | null;
  p_nome: string | null;
  p_ativo: boolean | null;
};

function deLinhaBruta(l: LinhaBruta): BloqueioDTO {
  return {
    id: l.id,
    profissionalId: l.profissional_id,
    inicio: l.inicio,
    fim: l.fim,
    motivo: l.motivo,
    profissional: l.profissional_id === null ? null : { id: l.profissional_id, nome: l.p_nome ?? '', ativo: l.p_ativo === true },
  };
}

/** Escopo + ID: NaoEncontrado para ID malformado ANTES de consultar. */
function escopoEId(ctx: ContextoEscopado, id: string): string {
  const salaoId = exigirEscopo(ctx);
  if (!ehUuid(id)) {
    throw new NaoEncontrado();
  }
  return salaoId;
}

export function criarRepoBloqueio(db: Executor): RepoBloqueio {
  async function buscar(ctx: ContextoEscopado, id: string): Promise<BloqueioDTO> {
    const salaoId = escopoEId(ctx, id);
    const linha = await db.bloqueio.findFirst({ where: { id, salaoId }, select: CAMPOS });
    if (!linha) {
      throw new NaoEncontrado();
    }
    return linha;
  }

  return {
    async fusoDoSalao(ctx) {
      const salaoId = exigirEscopo(ctx);
      const linha = await db.salao.findUnique({ where: { id: salaoId }, select: { fuso: true } });
      if (!linha) {
        throw new NaoEncontrado();
      }
      return linha.fuso;
    },

    async buscarProfissional(ctx, id) {
      const salaoId = escopoEId(ctx, id);
      const linha = await db.profissional.findFirst({ where: { id, salaoId }, select: { id: true, nome: true, ativo: true } });
      if (!linha) {
        throw new NaoEncontrado();
      }
      return linha;
    },

    async listarProfissionais(ctx) {
      const salaoId = exigirEscopo(ctx);
      return db.profissional.findMany({
        where: { salaoId },
        select: { id: true, nome: true, ativo: true },
        orderBy: [{ ativo: 'desc' }, { nome: 'asc' }, { id: 'asc' }],
      });
    },

    async criar(ctx, d) {
      const salaoId = exigirEscopo(ctx);
      if (d.profissionalId !== null && !ehUuid(d.profissionalId)) {
        throw new NaoEncontrado();
      }
      return db.bloqueio.create({
        data: { salaoId, profissionalId: d.profissionalId, inicio: d.inicio, fim: d.fim, motivo: d.motivo },
        select: CAMPOS,
      });
    },

    buscar,

    async travar(ctx, id) {
      const salaoId = escopoEId(ctx, id);
      const linhas = await db.$queryRaw<LinhaBruta[]>`
        SELECT b.id::text AS id, b.profissional_id::text AS profissional_id, b.inicio, b.fim, b.motivo,
               p.nome AS p_nome, p.ativo AS p_ativo
          FROM bloqueio b
          LEFT JOIN profissional p ON p.salao_id = b.salao_id AND p.id = b.profissional_id
         WHERE b.id = ${id}::uuid AND b.salao_id = ${salaoId}::uuid
           FOR UPDATE OF b`;
      const linha = linhas[0];
      if (!linha) {
        throw new NaoEncontrado();
      }
      return deLinhaBruta(linha);
    },

    async atualizarPeriodo(ctx, id, d) {
      const salaoId = escopoEId(ctx, id);
      const { count } = await db.bloqueio.updateMany({
        where: { id, salaoId },
        data: { inicio: d.inicio, fim: d.fim, motivo: d.motivo },
      });
      if (count === 0) {
        throw new NaoEncontrado();
      }
      return buscar(ctx, id);
    },

    async remover(ctx, id) {
      const salaoId = escopoEId(ctx, id);
      const { count } = await db.bloqueio.deleteMany({ where: { id, salaoId } });
      if (count === 0) {
        throw new NaoEncontrado();
      }
    },

    async listarVigentes(ctx, agora, filtro) {
      const salaoId = exigirEscopo(ctx);
      if ('profissionalId' in filtro && !ehUuid(filtro.profissionalId)) {
        throw new NaoEncontrado();
      }
      const doAlvo =
        'profissionalId' in filtro ? { OR: [{ profissionalId: filtro.profissionalId }, { profissionalId: null }] } : {};
      return db.bloqueio.findMany({
        where: { salaoId, fim: { gt: agora }, ...doAlvo },
        select: CAMPOS,
        orderBy: [...ORDEM],
      });
    },

    async listarNoPeriodo(ctx, { de, ate }, opcoes = {}) {
      const salaoId = exigirEscopo(ctx);
      const { profissionalId } = opcoes;
      if (profissionalId !== undefined && !ehUuid(profissionalId)) {
        throw new NaoEncontrado();
      }
      const linhas =
        profissionalId === undefined
          ? await db.$queryRaw<LinhaBruta[]>`
              SELECT b.id::text AS id, b.profissional_id::text AS profissional_id, b.inicio, b.fim, b.motivo,
                     p.nome AS p_nome, p.ativo AS p_ativo
                FROM bloqueio b
                LEFT JOIN profissional p ON p.salao_id = b.salao_id AND p.id = b.profissional_id
               WHERE b.salao_id = ${salaoId}::uuid
                 AND tstzrange(b.inicio, b.fim, '[)') && tstzrange(${de}::timestamptz, ${ate}::timestamptz, '[)')
               ORDER BY b.inicio, b.id`
          : await db.$queryRaw<LinhaBruta[]>`
              SELECT b.id::text AS id, b.profissional_id::text AS profissional_id, b.inicio, b.fim, b.motivo,
                     p.nome AS p_nome, p.ativo AS p_ativo
                FROM bloqueio b
                LEFT JOIN profissional p ON p.salao_id = b.salao_id AND p.id = b.profissional_id
               WHERE b.salao_id = ${salaoId}::uuid
                 AND tstzrange(b.inicio, b.fim, '[)') && tstzrange(${de}::timestamptz, ${ate}::timestamptz, '[)')
                 AND (b.profissional_id = ${profissionalId}::uuid OR b.profissional_id IS NULL)
               ORDER BY b.inicio, b.id`;
      return linhas.map(deLinhaBruta);
    },
  };
}
