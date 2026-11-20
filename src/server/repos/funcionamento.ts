import { Prisma } from '@/generated/prisma/client';
import type { ContextoEscopado } from '@/server/tenant/context';
import { exigirEscopo } from '@/server/tenant/context';
import { NaoEncontrado } from '@/server/tenant/erros';

import { ehUuid } from './ids';
import type { FuncionamentoDTO, FuncionamentoLinhaDTO } from './tipos';
import type { Executor } from './transacao';

// Repositório do horário de funcionamento do salão (D-020 §3.5; RN-11..RN-17). Todo método chama
// exigirEscopo(ctx): o salao_id vem só do contexto. O funcionamento é hora local de parede em minutos
// do dia (0 = domingo), como a jornada; `salao.funcionamento_definido` distingue "não informado"
// (false: não limita a disponibilidade) de "informado" (true: dia sem linhas = fechado).
//
// ORDEM CANÔNICA DE TRAVAS (D-020 §3.5; estende a D-014/D-015):
//   salao (FOR NO KEY UPDATE: regras, slug, perfil por UPDATE, funcionamento)
//     → profissional (FOR UPDATE | FOR NO KEY UPDATE | FOR SHARE)
//       → servico(s) → servico_profissional / jornada / salao_funcionamento / reserva / reserva_item
//
// GRAVAÇÃO (A-4): `SELECT funcionamento_definido FROM salao … FOR NO KEY UPDATE` (o mesmo marcador da
// D-017, procurado em pg_stat_activity pelos testes de concorrência: não altere o texto sem ajustá-los)
// → listar as linhas em COMANDO SEPARADO da trava (em READ COMMITTED, quem esperou a trava enxerga no
// comando seguinte o que a anterior confirmou) → DELETE dos removidos → INSERT dos novos (o INSERT toma
// FOR KEY SHARE em salao, compatível com a trava) → UPDATE do estado SÓ se mudou (IS DISTINCT FROM,
// atualizado_em = now(), porque o @updatedAt do Prisma não age em SQL bruto). Mesmo estado e mesma
// semana → nenhuma escrita: ids, xmin e atualizado_em ficam iguais (CA-4). NÃO usa FOR UPDATE, que
// bloquearia as inserções com FK para salao (reservas, bloqueios).
//
// LEITURA (A-5): um ÚNICO comando com o fragmento COLUNAS_FUNCIONAMENTO, que só agrega as linhas quando
// funcionamento_definido é verdadeiro. É a única fonte da semântica "não informado" (E3.1/E4.1).

type NovoIntervalo = { diaSemana: number; inicioMin: number; fimMin: number };

export interface RepoFuncionamento {
  /** Trava a linha do salão (FOR NO KEY UPDATE) e devolve o estado; sem linha → NaoEncontrado. Só dentro de emTransacao. */
  travar(ctx: ContextoEscopado): Promise<{ definido: boolean }>;
  /** Linhas do salão (em comando separado da trava), por dia_semana, inicio_min, id. */
  listar(ctx: ContextoEscopado): Promise<FuncionamentoLinhaDTO[]>;
  /** (1) DELETE dos ids de `remover` do salão; (2) INSERT de `inserir`. Listas vazias pulam o comando. */
  aplicarDiferenca(
    ctx: ContextoEscopado,
    d: { remover: readonly string[]; inserir: readonly NovoIntervalo[] },
  ): Promise<{ removidos: number; inseridos: number }>;
  /** UPDATE do estado só se mudou; devolve true se escreveu. Pré-condição: trava tomada. */
  definirEstado(ctx: ContextoEscopado, definido: boolean): Promise<boolean>;
  /** Leitura consistente (um comando); salão inexistente → NaoEncontrado. */
  ler(ctx: ContextoEscopado): Promise<FuncionamentoDTO>;
}

/**
 * Fragmento único usado por `ler`, `lerFuncionamentoPublico` e `lerPerfilPublico` e, na E3.1, pelo
 * repositório de disponibilidade. Supõe o alias `s` para salao.
 */
export const COLUNAS_FUNCIONAMENTO: Prisma.Sql = Prisma.sql`
  s.funcionamento_definido AS funcionamento_definido,
  COALESCE((SELECT json_agg(json_build_object('diaSemana', f.dia_semana, 'inicioMin', f.inicio_min, 'fimMin', f.fim_min)
                            ORDER BY f.dia_semana, f.inicio_min)
              FROM salao_funcionamento f
             WHERE f.salao_id = s.id AND s.funcionamento_definido), '[]'::json) AS funcionamento_linhas`;

/** Linha bruta com as duas colunas de COLUNAS_FUNCIONAMENTO. */
export type ColunasFuncionamento = { funcionamento_definido: boolean; funcionamento_linhas: unknown };

const ehInteiro = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/** Converte as duas colunas do fragmento em FuncionamentoDTO; forma inesperada → Error. */
export function funcionamentoDaLinha(l: ColunasFuncionamento): FuncionamentoDTO {
  if (typeof l.funcionamento_definido !== 'boolean' || !Array.isArray(l.funcionamento_linhas)) {
    throw new Error('funcionamento: forma inesperada da leitura');
  }
  const linhas = l.funcionamento_linhas.map((x: unknown) => {
    const o = x as Record<string, unknown> | null;
    if (!o || !ehInteiro(o.diaSemana) || !ehInteiro(o.inicioMin) || !ehInteiro(o.fimMin)) {
      throw new Error('funcionamento: linha com forma inesperada');
    }
    return { diaSemana: o.diaSemana, inicioMin: o.inicioMin, fimMin: o.fimMin };
  });
  return { definido: l.funcionamento_definido, linhas: l.funcionamento_definido ? linhas : [] };
}

export function criarRepoFuncionamento(db: Executor): RepoFuncionamento {
  return {
    async travar(ctx) {
      const salaoId = exigirEscopo(ctx);
      const linhas = await db.$queryRaw<{ funcionamento_definido: boolean }[]>`
        SELECT funcionamento_definido FROM salao WHERE id = ${salaoId}::uuid FOR NO KEY UPDATE`;
      const linha = linhas[0];
      if (!linha) {
        throw new NaoEncontrado();
      }
      return { definido: linha.funcionamento_definido };
    },

    async listar(ctx) {
      const salaoId = exigirEscopo(ctx);
      return db.salaoFuncionamento.findMany({
        where: { salaoId },
        select: { id: true, diaSemana: true, inicioMin: true, fimMin: true },
        orderBy: [{ diaSemana: 'asc' }, { inicioMin: 'asc' }, { id: 'asc' }],
      });
    },

    async aplicarDiferenca(ctx, d) {
      const salaoId = exigirEscopo(ctx);
      let removidos = 0;
      let inseridos = 0;
      const ids = d.remover.filter((id) => ehUuid(id));
      if (ids.length > 0) {
        ({ count: removidos } = await db.salaoFuncionamento.deleteMany({ where: { id: { in: ids }, salaoId } }));
      }
      if (d.inserir.length > 0) {
        ({ count: inseridos } = await db.salaoFuncionamento.createMany({
          data: d.inserir.map((i) => ({ salaoId, diaSemana: i.diaSemana, inicioMin: i.inicioMin, fimMin: i.fimMin })),
        }));
      }
      return { removidos, inseridos };
    },

    async definirEstado(ctx, definido) {
      const salaoId = exigirEscopo(ctx);
      const n = await db.$executeRaw`
        UPDATE salao SET funcionamento_definido = ${definido}, atualizado_em = now()
         WHERE id = ${salaoId}::uuid AND funcionamento_definido IS DISTINCT FROM ${definido}`;
      return n > 0;
    },

    async ler(ctx) {
      const salaoId = exigirEscopo(ctx);
      const linhas = await db.$queryRaw<ColunasFuncionamento[]>`
        SELECT ${COLUNAS_FUNCIONAMENTO} FROM salao s WHERE s.id = ${salaoId}::uuid`;
      const linha = linhas[0];
      if (!linha) {
        throw new NaoEncontrado();
      }
      return funcionamentoDaLinha(linha);
    },
  };
}
