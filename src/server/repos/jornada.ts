import type { ContextoEscopado } from '@/server/tenant/context';
import { exigirEscopo } from '@/server/tenant/context';
import { NaoEncontrado } from '@/server/tenant/erros';

import { ehUuid } from './ids';
import type { JornadaLinhaDTO, TravaJornada } from './tipos';
import type { Executor } from './transacao';

// Repositório da jornada semanal (D-015 §3.2). Todo método filtra pelo salão do contexto; id que
// não é UUID → NaoEncontrado sem consultar. A jornada é hora local de parede em minutos do dia
// (RN-10); 0 = domingo (RN-15).
//
// ORDEM CANÔNICA DE TRAVAS (D-014 §3.2, estendida pela D-015 D-12):
//   profissional (FOR UPDATE | FOR NO KEY UPDATE | FOR SHARE, por id)
//     → servico(s)
//       → servico_profissional / jornada / reserva / reserva_item
// - Salvar a jornada: profissional FOR NO KEY UPDATE OF pj → leitura de jornada → DELETE/INSERT.
//   Não toca servico, reserva, sessao nem convite. O INSERT em jornada toma FOR KEY SHARE na mesma
//   linha de profissional, compatível com a trava que a transação já tem.
// - FOR NO KEY UPDATE conflita com o FOR UPDATE da desativação (D-013) e com o FOR SHARE da
//   conferência de reserva (E3.2): as operações se serializam, sem ciclo. NÃO conflita com o
//   FOR KEY SHARE de inserções de reserva/convite/vínculo: salvar a jornada não atrasa reservas.
// O marcador "FOR NO KEY UPDATE OF pj" é procurado em pg_stat_activity pelos testes de concorrência:
// não altere o texto sem ajustá-los.

type NovoIntervalo = { diaSemana: number; inicioMin: number; fimMin: number };

export interface RepoJornada {
  /**
   * Linhas do profissional NO SALÃO do contexto, ordenadas por dia_semana, inicio_min, id. Não
   * verifica a existência do profissional (o chamador já o buscou/travou).
   */
  listarDoProfissional(ctx: ContextoEscopado, profissionalId: string): Promise<JornadaLinhaDTO[]>;
  /**
   * SELECT … FROM profissional pj … FOR NO KEY UPDATE OF pj. Sem linha → NaoEncontrado. NÃO filtra
   * `ativo` (RN-13). Só faz sentido dentro de emTransacao.
   */
  travarProfissional(ctx: ContextoEscopado, profissionalId: string): Promise<TravaJornada>;
  /** Busca sem trava (leitura da página): mesma projeção; NaoEncontrado se não é do salão. */
  buscarProfissional(ctx: ContextoEscopado, profissionalId: string): Promise<TravaJornada>;
  /**
   * No MESMO executor e nesta ordem: (1) DELETE dos ids de `remover` do profissional e do salão;
   * (2) INSERT de `inserir` com o salão do contexto. Listas vazias pulam o comando. Pré-condição: o
   * chamador tem a trava do profissional.
   */
  aplicarDiferenca(
    ctx: ContextoEscopado,
    profissionalId: string,
    d: { remover: readonly string[]; inserir: readonly NovoIntervalo[] },
  ): Promise<{ removidos: number; inseridos: number }>;
}

/** Escopo + ID: NaoEncontrado para ID malformado ANTES de consultar. */
function escopoEId(ctx: ContextoEscopado, id: string): string {
  const salaoId = exigirEscopo(ctx);
  if (!ehUuid(id)) {
    throw new NaoEncontrado();
  }
  return salaoId;
}

export function criarRepoJornada(db: Executor): RepoJornada {
  return {
    async listarDoProfissional(ctx, profissionalId) {
      const salaoId = escopoEId(ctx, profissionalId);
      return db.jornada.findMany({
        where: { salaoId, profissionalId },
        select: { id: true, diaSemana: true, inicioMin: true, fimMin: true },
        orderBy: [{ diaSemana: 'asc' }, { inicioMin: 'asc' }, { id: 'asc' }],
      });
    },

    async travarProfissional(ctx, profissionalId) {
      const salaoId = escopoEId(ctx, profissionalId);
      const linhas = await db.$queryRaw<TravaJornada[]>`
        SELECT pj.id::text AS id, pj.nome, pj.ativo
          FROM profissional pj
         WHERE pj.id = ${profissionalId}::uuid AND pj.salao_id = ${salaoId}::uuid
           FOR NO KEY UPDATE OF pj`;
      const linha = linhas[0];
      if (!linha) {
        throw new NaoEncontrado();
      }
      return linha;
    },

    async buscarProfissional(ctx, profissionalId) {
      const salaoId = escopoEId(ctx, profissionalId);
      const linha = await db.profissional.findFirst({
        where: { id: profissionalId, salaoId },
        select: { id: true, nome: true, ativo: true },
      });
      if (!linha) {
        throw new NaoEncontrado();
      }
      return linha;
    },

    async aplicarDiferenca(ctx, profissionalId, d) {
      const salaoId = escopoEId(ctx, profissionalId);
      let removidos = 0;
      let inseridos = 0;
      const ids = d.remover.filter((id) => ehUuid(id));
      if (ids.length > 0) {
        ({ count: removidos } = await db.jornada.deleteMany({
          where: { id: { in: ids }, salaoId, profissionalId },
        }));
      }
      if (d.inserir.length > 0) {
        ({ count: inseridos } = await db.jornada.createMany({
          data: d.inserir.map((i) => ({
            salaoId,
            profissionalId,
            diaSemana: i.diaSemana,
            inicioMin: i.inicioMin,
            fimMin: i.fimMin,
          })),
        }));
      }
      return { removidos, inseridos };
    },
  };
}
