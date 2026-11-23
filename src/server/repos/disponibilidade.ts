import { Prisma } from '@/generated/prisma/client';
import { exigirLeituraDeAgenda } from '@/server/tenant/context';
import type { ContextoDeLeituraDeAgenda } from '@/server/tenant/context';
import { NaoEncontrado } from '@/server/tenant/erros';

import { COLUNAS_FUNCIONAMENTO, funcionamentoDaLinha } from './funcionamento';
import type { ColunasFuncionamento } from './funcionamento';
import { ehUuid } from './ids';
import { ondeServicoOfertavel } from './publico';
import type { FuncionamentoDTO, Periodo } from './tipos';
import type { Executor } from './transacao';

// Leituras de agenda para o cálculo de disponibilidade (D-018 §3.3, parecer do DBA em dba.md).
// SEIS leituras, UMA instrução SQL cada, em lote por lista de profissionais (RN-19: o número de
// consultas independe de datas e profissionais). Aceita PublicoContext, TenantContext e SistemaContext
// (exigirLeituraDeAgenda) e recusa o AdminContext. Projeção mínima: nunca cliente, status, id de reserva
// nem `motivo` de bloqueio (R-3). Todo SQL filtra `salao_id`. Sem transação nem trava (D-10): leitura.
//
// NÃO troque os literais por parâmetros nem junte variantes com `$p IS NULL OR ...` (lição da D-016):
// o literal de status e a expressão `tstzrange(i.inicio, i.ocupado_ate, '[)')` de `consultaOcupacoes`
// são o que torna aplicável o índice parcial `reserva_item_sem_sobreposicao` (D-050, dba.md Q6). A
// ocupação é do ITEM (`reserva_item`): cada item tem profissional, início e ocupado-até próprios.

export type RegrasDoSalao = {
  fuso: string;
  gradeMin: number;
  antecedenciaMin: number;
  janelaDias: number;
  intervaloMin: number;
};
/** Regras e funcionamento da MESMA instrução (A-9); o serviço converte o funcionamento. */
export type RegrasEFuncionamento = { regras: RegrasDoSalao; funcionamento: FuncionamentoDTO };
export type ServicoOfertavel = { id: string; nome: string; precoCentavos: number; duracaoMin: number };
/** `servicos` = ids de `servicoIds` que ele executa (minúsculas, ordem dos ids), D-050 RN-7. */
export type CandidatoProfissional = { id: string; nome: string; ativo: boolean; servicos: string[] };
export type LinhaJornadaDeAgenda = { profissionalId: string; diaSemana: number; inicioMin: number; fimMin: number };
/** `profissionalId` null = bloqueio do salão inteiro. Sem `motivo`. */
export type BloqueioDeAgenda = { profissionalId: string | null; inicio: Date; fim: Date };
/** Sem id, cliente nem status. */
export type OcupacaoDeAgenda = { profissionalId: string; inicio: Date; ocupadoAte: Date };

export interface RepoDisponibilidade {
  /** 1 SQL (salão do contexto, regras + COLUNAS_FUNCIONAMENTO). Sem linha → NaoEncontrado. */
  lerRegras(ctx: ContextoDeLeituraDeAgenda): Promise<RegrasEFuncionamento>;
  /** 1 SQL (ondeServicoOfertavel + id IN). Ids não-UUID são descartados; sobrando nenhum → [] sem SQL. */
  servicosOfertaveis(ctx: ContextoDeLeituraDeAgenda, ids: readonly string[]): Promise<ServicoOfertavel[]>;
  /**
   * 1 SQL. `profissionalIds` null → ativos do salão; lista → só eles (ativos ou não; lista vazia → []
   * sem SQL). Ordem nome, id. `servicos` = ids de `servicoIds` que ele executa. Algum id malformado →
   * NaoEncontrado sem SQL; de outro salão ou inexistente simplesmente não volta.
   */
  candidatos(
    ctx: ContextoDeLeituraDeAgenda,
    servicoIds: readonly string[],
    profissionalIds: readonly string[] | null,
  ): Promise<CandidatoProfissional[]>;
  /** 1 SQL; lista vazia → [] sem SQL. Ordem profissional, dia, início. */
  jornadas(ctx: ContextoDeLeituraDeAgenda, profissionalIds: readonly string[]): Promise<LinhaJornadaDeAgenda[]>;
  /** 1 SQL: bloqueios do salão (profissional nulo) e dos informados que intersectam [de, ate). */
  bloqueios(ctx: ContextoDeLeituraDeAgenda, profissionalIds: readonly string[], periodo: Periodo): Promise<BloqueioDeAgenda[]>;
  /** 1 SQL (`consultaOcupacoes`); lista vazia → [] sem SQL. */
  ocupacoes(ctx: ContextoDeLeituraDeAgenda, profissionalIds: readonly string[], periodo: Periodo): Promise<OcupacaoDeAgenda[]>;
}

type LinhaRegras = ColunasFuncionamento & {
  fuso: string;
  grade_min: number;
  antecedencia_min: number;
  janela_dias: number;
  intervalo_min: number;
};

const soUuids = (ids: readonly string[]): string[] => ids.filter((id) => ehUuid(id));

/**
 * Ocupação por profissional sobre os ITENS (D-050, dba.md Q6; forma da D-018 A-5): `unnest` + `CROSS
 * JOIN LATERAL` dá um acesso ao índice por profissional, numa única instrução. Exportada para o teste de
 * plano (CA-3).
 */
export function consultaOcupacoes(salaoId: string, profissionalIds: readonly string[], periodo: Periodo): Prisma.Sql {
  return Prisma.sql`
    SELECT x.pid::text AS profissional_id, o.inicio, o.ocupado_ate
      FROM unnest(${soUuids(profissionalIds)}::uuid[]) AS x(pid)
      CROSS JOIN LATERAL (
        SELECT i.id, i.inicio, i.ocupado_ate
          FROM reserva_item i
         WHERE i.profissional_id = x.pid
           AND i.salao_id = ${salaoId}::uuid
           AND i.status IN ('confirmado', 'concluido', 'nao_compareceu')
           AND tstzrange(i.inicio, i.ocupado_ate, '[)') && tstzrange(${periodo.de}::timestamptz, ${periodo.ate}::timestamptz, '[)')
      ) o
     ORDER BY x.pid, o.inicio, o.id`;
}

export function criarRepoDisponibilidade(db: Executor): RepoDisponibilidade {
  return {
    async lerRegras(ctx) {
      const salaoId = exigirLeituraDeAgenda(ctx);
      const linhas = await db.$queryRaw<LinhaRegras[]>`
        SELECT s.fuso, s.grade_min, s.antecedencia_min, s.janela_dias, s.intervalo_min, ${COLUNAS_FUNCIONAMENTO}
          FROM salao s
         WHERE s.id = ${salaoId}::uuid`;
      const l = linhas[0];
      if (!l) {
        throw new NaoEncontrado();
      }
      return {
        regras: {
          fuso: l.fuso,
          gradeMin: l.grade_min,
          antecedenciaMin: l.antecedencia_min,
          janelaDias: l.janela_dias,
          intervaloMin: l.intervalo_min,
        },
        funcionamento: funcionamentoDaLinha(l),
      };
    },

    async servicosOfertaveis(ctx, ids) {
      const salaoId = exigirLeituraDeAgenda(ctx);
      const validos = soUuids(ids);
      if (validos.length === 0) {
        return [];
      }
      return db.servico.findMany({
        where: { ...ondeServicoOfertavel(salaoId), id: { in: validos } },
        select: { id: true, nome: true, precoCentavos: true, duracaoMin: true },
        orderBy: [{ nome: 'asc' }, { id: 'asc' }],
      });
    },

    async candidatos(ctx, servicoIds, profissionalIds) {
      const salaoId = exigirLeituraDeAgenda(ctx);
      if (profissionalIds !== null && !profissionalIds.every((id) => ehUuid(id))) {
        throw new NaoEncontrado();
      }
      if (profissionalIds !== null && profissionalIds.length === 0) {
        return [];
      }
      const servicos = soUuids(servicoIds);
      const filtro =
        profissionalIds === null ? Prisma.sql`AND p.ativo` : Prisma.sql`AND p.id = ANY(${[...profissionalIds]}::uuid[])`;
      return db.$queryRaw<CandidatoProfissional[]>`
        SELECT p.id::text AS id, p.nome, p.ativo,
               ARRAY(SELECT sp.servico_id::text FROM servico_profissional sp
                      WHERE sp.salao_id = p.salao_id AND sp.profissional_id = p.id
                        AND sp.servico_id = ANY(${servicos}::uuid[])
                      ORDER BY sp.servico_id) AS servicos
          FROM profissional p
         WHERE p.salao_id = ${salaoId}::uuid ${filtro}
         ORDER BY p.nome, p.id`;
    },

    async jornadas(ctx, profissionalIds) {
      const salaoId = exigirLeituraDeAgenda(ctx);
      const ids = soUuids(profissionalIds);
      if (ids.length === 0) {
        return [];
      }
      const linhas = await db.jornada.findMany({
        where: { salaoId, profissionalId: { in: ids } },
        select: { profissionalId: true, diaSemana: true, inicioMin: true, fimMin: true },
        orderBy: [{ profissionalId: 'asc' }, { diaSemana: 'asc' }, { inicioMin: 'asc' }, { id: 'asc' }],
      });
      return linhas;
    },

    async bloqueios(ctx, profissionalIds, periodo) {
      const salaoId = exigirLeituraDeAgenda(ctx);
      const linhas = await db.$queryRaw<{ profissional_id: string | null; inicio: Date; fim: Date }[]>`
        SELECT b.profissional_id::text AS profissional_id, b.inicio, b.fim
          FROM bloqueio b
         WHERE b.salao_id = ${salaoId}::uuid
           AND tstzrange(b.inicio, b.fim, '[)') && tstzrange(${periodo.de}::timestamptz, ${periodo.ate}::timestamptz, '[)')
           AND (b.profissional_id IS NULL OR b.profissional_id = ANY(${soUuids(profissionalIds)}::uuid[]))
         ORDER BY b.inicio, b.id`;
      return linhas.map((l) => ({ profissionalId: l.profissional_id, inicio: l.inicio, fim: l.fim }));
    },

    async ocupacoes(ctx, profissionalIds, periodo) {
      const salaoId = exigirLeituraDeAgenda(ctx);
      const ids = soUuids(profissionalIds);
      if (ids.length === 0) {
        return [];
      }
      const linhas = await db.$queryRaw<{ profissional_id: string; inicio: Date; ocupado_ate: Date }[]>(
        consultaOcupacoes(salaoId, ids, periodo),
      );
      return linhas.map((l) => ({ profissionalId: l.profissional_id, inicio: l.inicio, ocupadoAte: l.ocupado_ate }));
    },
  };
}
