import type { ContextoEscopado } from '@/server/tenant/context';
import { exigirEscopo } from '@/server/tenant/context';
import { NaoEncontrado } from '@/server/tenant/erros';

import { ehUuid } from './ids';
import type { DadosServico, ProfissionalVinculoDTO, ServicoDTO, ServicoPainelDTO } from './tipos';
import type { Executor } from './transacao';

// Repositório de serviços e dos vínculos serviço × profissional (D-005; D-014 §3.2). Todo método
// filtra pelo salão do contexto; id que não é UUID → NaoEncontrado sem consultar.
//
// ORDEM CANÔNICA DE TRAVAS (D-014 D-14; obrigação para E3.1/E3.2/E3.4/E3.5):
//   profissional(is) (FOR SHARE ou FOR UPDATE, por id)
//     → servico(s) (FOR SHARE / FOR NO KEY UPDATE, por id)
//       → servico_profissional / reserva / reserva_item
// - Editar serviço: profissionais escolhidos FOR SHARE → serviço FOR NO KEY UPDATE → UPDATE do
//   serviço → DELETE/INSERT de vínculos.
// - Criar serviço: profissionais escolhidos FOR SHARE → INSERT do serviço → INSERT de vínculos.
// - Desativar/reativar serviço: só a linha do serviço (UPDATE).
// A trava do serviço é FOR NO KEY UPDATE (D-15), que não conflita com o FOR KEY SHARE de inserções
// de reserva_item/vínculos. Os marcadores "FOR SHARE OF p" e "FOR NO KEY UPDATE OF s" são procurados
// em pg_stat_activity pelos testes de concorrência: não altere o texto sem ajustá-los.

export interface RepoServico {
  buscarPorId(ctx: ContextoEscopado, id: string): Promise<ServicoDTO>;
  /** Ativos e inativos do salão (RN-16), por nome. */
  listar(ctx: ContextoEscopado): Promise<ServicoDTO[]>;
  renomear(ctx: ContextoEscopado, id: string, nome: string): Promise<ServicoDTO>;
  /** Novo serviço, ativo (default do banco). */
  criar(ctx: ContextoEscopado, d: DadosServico): Promise<ServicoDTO>;
  /** D-10: ativos primeiro, nome, id; contagem só de profissionais ATIVOS vinculados (CA-10). */
  listarParaPainel(ctx: ContextoEscopado): Promise<ServicoPainelDTO[]>;
  buscarParaPainel(ctx: ContextoEscopado, id: string): Promise<ServicoPainelDTO>;
  /**
   * Profissionais ativos do salão (vinculado true/false) + inativos VINCULADOS a este serviço.
   * Ordem: ativo desc, nome, id. Não verifica a existência do serviço (o chamador já buscou).
   */
  listarProfissionaisParaVinculo(ctx: ContextoEscopado, servicoId: string): Promise<ProfissionalVinculoDTO[]>;
  /**
   * Trava FOR SHARE os profissionais ATIVOS do salão entre `ids` e devolve os encontrados. Ids que
   * não são UUID são descartados antes (nunca 22P02); lista vazia → [] sem consulta. Só faz sentido
   * dentro de emTransacao.
   */
  travarProfissionaisParaVinculo(ctx: ContextoEscopado, ids: readonly string[]): Promise<string[]>;
  /** SELECT … FOR NO KEY UPDATE OF s na linha do serviço. Sem linha → NaoEncontrado. */
  travarParaAlteracao(ctx: ContextoEscopado, id: string): Promise<{ id: string; ativo: boolean }>;
  atualizarDados(ctx: ContextoEscopado, id: string, d: DadosServico): Promise<ServicoDTO>;
  /** ativo = true/false; NaoEncontrado se a linha não é do salão (a de outro salão nunca é tocada). */
  definirAtivo(ctx: ContextoEscopado, id: string, ativo: boolean): Promise<ServicoDTO>;
  /**
   * Pré-condições: o chamador tem a trava do serviço e validou `ids` com
   * travarProfissionaisParaVinculo (todos ativos e do salão). Remove os vínculos com profissionais
   * ATIVOS fora de `ids` e insere os que faltam (ON CONFLICT DO NOTHING). Vínculos com profissionais
   * INATIVOS nunca são apagados (RN-9, RN-10).
   */
  substituirVinculosAtivos(
    ctx: ContextoEscopado,
    servicoId: string,
    ids: readonly string[],
  ): Promise<{ adicionados: number; removidos: number }>;
}

const CAMPOS = {
  id: true,
  nome: true,
  precoCentavos: true,
  duracaoMin: true,
  ativo: true,
  criadoEm: true,
  atualizadoEm: true,
} as const;

const CAMPOS_PAINEL = {
  ...CAMPOS,
  _count: { select: { profissionais: { where: { profissional: { ativo: true } } } } },
} as const;

type LinhaPainel = ServicoDTO & { _count: { profissionais: number } };

function paraPainel({ _count, ...s }: LinhaPainel): ServicoPainelDTO {
  return { ...s, profissionaisAtivos: _count.profissionais };
}

/** Escopo + ID: NaoEncontrado para ID malformado ANTES de consultar. */
function escopoEId(ctx: ContextoEscopado, id: string): string {
  const salaoId = exigirEscopo(ctx);
  if (!ehUuid(id)) {
    throw new NaoEncontrado();
  }
  return salaoId;
}

export function criarRepoServico(db: Executor): RepoServico {
  async function buscarPorId(ctx: ContextoEscopado, id: string): Promise<ServicoDTO> {
    const salaoId = escopoEId(ctx, id);
    const servico = await db.servico.findFirst({ where: { id, salaoId }, select: CAMPOS });
    if (!servico) {
      throw new NaoEncontrado();
    }
    return servico;
  }

  /** UPDATE escopado pelo salão (Prisma grava atualizado_em); nenhuma linha → NaoEncontrado. */
  async function atualizar(
    ctx: ContextoEscopado,
    id: string,
    data: { nome?: string; precoCentavos?: number; duracaoMin?: number; ativo?: boolean },
  ): Promise<ServicoDTO> {
    const salaoId = escopoEId(ctx, id);
    const { count } = await db.servico.updateMany({ where: { id, salaoId }, data });
    if (count === 0) {
      throw new NaoEncontrado();
    }
    return buscarPorId(ctx, id);
  }

  return {
    buscarPorId,

    async listar(ctx) {
      const salaoId = exigirEscopo(ctx);
      return db.servico.findMany({
        where: { salaoId },
        select: CAMPOS,
        orderBy: [{ nome: 'asc' }, { id: 'asc' }],
      });
    },

    async renomear(ctx, id, nome) {
      return atualizar(ctx, id, { nome });
    },

    async criar(ctx, d) {
      const salaoId = exigirEscopo(ctx);
      return db.servico.create({
        data: { salaoId, nome: d.nome, precoCentavos: d.precoCentavos, duracaoMin: d.duracaoMin },
        select: CAMPOS,
      });
    },

    async listarParaPainel(ctx) {
      const salaoId = exigirEscopo(ctx);
      const linhas = await db.servico.findMany({
        where: { salaoId },
        select: CAMPOS_PAINEL,
        orderBy: [{ ativo: 'desc' }, { nome: 'asc' }, { id: 'asc' }],
      });
      return linhas.map(paraPainel);
    },

    async buscarParaPainel(ctx, id) {
      const salaoId = escopoEId(ctx, id);
      const linha = await db.servico.findFirst({ where: { id, salaoId }, select: CAMPOS_PAINEL });
      if (!linha) {
        throw new NaoEncontrado();
      }
      return paraPainel(linha);
    },

    async listarProfissionaisParaVinculo(ctx, servicoId) {
      const salaoId = escopoEId(ctx, servicoId);
      const linhas = await db.profissional.findMany({
        where: {
          salaoId,
          OR: [{ ativo: true }, { servicos: { some: { servicoId } } }],
        },
        select: { id: true, nome: true, ativo: true, servicos: { where: { servicoId }, select: { servicoId: true } } },
        orderBy: [{ ativo: 'desc' }, { nome: 'asc' }, { id: 'asc' }],
      });
      return linhas.map((p) => ({ id: p.id, nome: p.nome, ativo: p.ativo, vinculado: p.servicos.length > 0 }));
    },

    async travarProfissionaisParaVinculo(ctx, ids) {
      const salaoId = exigirEscopo(ctx);
      const validos = ids.filter((id) => ehUuid(id));
      if (validos.length === 0) {
        return [];
      }
      const linhas = await db.$queryRaw<{ id: string }[]>`
        SELECT p.id::text AS id
          FROM profissional p
         WHERE p.salao_id = ${salaoId}::uuid AND p.id = ANY(${validos}::uuid[]) AND p.ativo
         ORDER BY p.id
           FOR SHARE OF p`;
      return linhas.map((l) => l.id);
    },

    async travarParaAlteracao(ctx, id) {
      const salaoId = escopoEId(ctx, id);
      const linhas = await db.$queryRaw<{ id: string; ativo: boolean }[]>`
        SELECT s.id::text AS id, s.ativo
          FROM servico s
         WHERE s.id = ${id}::uuid AND s.salao_id = ${salaoId}::uuid
           FOR NO KEY UPDATE OF s`;
      const linha = linhas[0];
      if (!linha) {
        throw new NaoEncontrado();
      }
      return linha;
    },

    async atualizarDados(ctx, id, d) {
      return atualizar(ctx, id, { nome: d.nome, precoCentavos: d.precoCentavos, duracaoMin: d.duracaoMin });
    },

    async definirAtivo(ctx, id, ativo) {
      return atualizar(ctx, id, { ativo });
    },

    async substituirVinculosAtivos(ctx, servicoId, ids) {
      const salaoId = escopoEId(ctx, servicoId);
      const lista = [...ids];
      const removidos = await db.$executeRaw`
        DELETE FROM servico_profissional sp
         USING profissional p
         WHERE sp.salao_id = ${salaoId}::uuid AND sp.servico_id = ${servicoId}::uuid
           AND p.salao_id = sp.salao_id AND p.id = sp.profissional_id AND p.ativo
           AND sp.profissional_id <> ALL(${lista}::uuid[])`;
      const adicionados =
        lista.length === 0
          ? 0
          : await db.$executeRaw`
        INSERT INTO servico_profissional (salao_id, servico_id, profissional_id)
        SELECT ${salaoId}::uuid, ${servicoId}::uuid, x
          FROM unnest(${lista}::uuid[]) AS x
        ON CONFLICT (salao_id, servico_id, profissional_id) DO NOTHING`;
      return { adicionados, removidos };
    },
  };
}
