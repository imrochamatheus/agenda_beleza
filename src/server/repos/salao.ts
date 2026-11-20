import type { ContextoEscopado } from '@/server/tenant/context';
import { exigirEscopo } from '@/server/tenant/context';
import { NaoEncontrado } from '@/server/tenant/erros';

import type { ConfiguracoesDTO, ResultadoTrocaSlugDTO, SlugsDoSalaoDTO } from './tipos';
import type { Executor } from './transacao';

// Repositório das configurações do salão (D-017 §3.3). Todo método chama exigirEscopo(ctx): o salao_id
// vem só do contexto. Sem DDL nova: a PK de salao_slug (unicidade global entre atuais e históricos),
// salao_slug_formato_chk e o índice único PARCIAL salao_slug_atual_uniq (um atual por salão; índice,
// não constraint, então NÃO pode ser adiado: é conferido a cada comando) garantem RN-3/RN-4.
//
// TRAVA (D-18): `SELECT … FROM salao … FOR NO KEY UPDATE`. Serializa, por salão, a troca de slug e a
// gravação das regras (o UPDATE de colunas que não são chave toma a mesma trava). NÃO usa FOR UPDATE,
// que conflitaria com o FOR KEY SHARE tomado por todo INSERT com FK para salao (reserva, bloqueio,
// cliente…): a troca de slug não bloqueia reservas. O texto "FOR NO KEY UPDATE" é o marcador procurado
// em pg_stat_activity pelos testes de concorrência: não altere sem ajustá-los.
//
// TROCA DE SLUG (D-19), depois de travar e com o novo já validado e diferente do atual:
//   1. INSERT (novo, salão, atual = false) ON CONFLICT (slug) DO NOTHING RETURNING
//      sem linha → lê o dono: outro salão → 'em_uso' sem ter gravado nada; o próprio (histórico) → segue
//   2. UPDATE … SET atual = false WHERE salão AND atual            (rebaixa; exatamente 1 linha)
//   3. UPDATE … SET atual = true  WHERE salão AND slug = novo     (promove; exatamente 1 linha)
// Inserir já como atual antes de rebaixar violaria o índice parcial. Sem ciclo de espera entre salões:
// a única espera possível entre salões é o passo 1 esperando outra transação que inseriu a mesma chave;
// os passos 2 e 3 só tocam linhas do próprio salão, já serializado pela trava. Troca cruzada (A pede o
// atual de B e B o de A): cada passo 1 vê a linha confirmada do outro e devolve 'em_uso' sem esperar.
// Nunca captura violação de constraint (23505): ON CONFLICT decide sem abortar a transação.
//
// LEITURA DO ATUAL em comando SEPARADO da trava: em READ COMMITTED, a transação que esperou a trava
// enxerga, no comando seguinte, o que a anterior confirmou. Juntar a leitura de salao_slug ao
// FOR NO KEY UPDATE não serviria: a releitura (EvalPlanQual) só atualiza a linha travada.

export interface RepoSalao {
  /** Configurações do salão do contexto; sem linha → NaoEncontrado. */
  obterConfiguracoes(ctx: ContextoEscopado): Promise<ConfiguracoesDTO>;
  /** Atual (exatamente um; zero → NaoEncontrado) e anteriores por criado_em desc, slug asc. */
  listarSlugs(ctx: ContextoEscopado): Promise<SlugsDoSalaoDTO>;
  /** Trava a linha do salão (FOR NO KEY UPDATE) e devolve o fuso. Só dentro de emTransacao. */
  travar(ctx: ContextoEscopado): Promise<{ fuso: string }>;
  /** Slug atual, em comando separado da trava. Zero → NaoEncontrado. */
  slugAtual(ctx: ContextoEscopado): Promise<string>;
  /** Grava os seis campos (atualizado_em por @updatedAt); 0 linhas → NaoEncontrado. */
  atualizarConfiguracoes(ctx: ContextoEscopado, d: ConfiguracoesDTO): Promise<void>;
  /** Passos 1–3 acima. Não toca a linha de salao. */
  trocarSlug(ctx: ContextoEscopado, novo: string): Promise<ResultadoTrocaSlugDTO>;
}

const CAMPOS = {
  nome: true,
  fuso: true,
  gradeMin: true,
  antecedenciaMin: true,
  janelaDias: true,
  intervaloMin: true,
} as const;

export function criarRepoSalao(db: Executor): RepoSalao {
  return {
    async obterConfiguracoes(ctx) {
      const salaoId = exigirEscopo(ctx);
      const linha = await db.salao.findUnique({ where: { id: salaoId }, select: CAMPOS });
      if (!linha) {
        throw new NaoEncontrado();
      }
      return linha;
    },

    async listarSlugs(ctx) {
      const salaoId = exigirEscopo(ctx);
      const linhas = await db.salaoSlug.findMany({
        where: { salaoId },
        select: { slug: true, atual: true, criadoEm: true },
        orderBy: [{ criadoEm: 'desc' }, { slug: 'asc' }],
      });
      const atual = linhas.find((l) => l.atual);
      if (!atual) {
        throw new NaoEncontrado();
      }
      return {
        atual: atual.slug,
        anteriores: linhas.filter((l) => !l.atual).map((l) => ({ slug: l.slug, criadoEm: l.criadoEm })),
      };
    },

    async travar(ctx) {
      const salaoId = exigirEscopo(ctx);
      const linhas = await db.$queryRaw<{ fuso: string }[]>`
        SELECT fuso FROM salao WHERE id = ${salaoId}::uuid FOR NO KEY UPDATE`;
      const linha = linhas[0];
      if (!linha) {
        throw new NaoEncontrado();
      }
      return { fuso: linha.fuso };
    },

    async slugAtual(ctx) {
      const salaoId = exigirEscopo(ctx);
      const linhas = await db.$queryRaw<{ slug: string }[]>`
        SELECT slug FROM salao_slug WHERE salao_id = ${salaoId}::uuid AND atual`;
      const linha = linhas[0];
      if (!linha) {
        throw new NaoEncontrado();
      }
      return linha.slug;
    },

    async atualizarConfiguracoes(ctx, d) {
      const salaoId = exigirEscopo(ctx);
      const { count } = await db.salao.updateMany({
        where: { id: salaoId },
        data: {
          nome: d.nome,
          fuso: d.fuso,
          gradeMin: d.gradeMin,
          antecedenciaMin: d.antecedenciaMin,
          janelaDias: d.janelaDias,
          intervaloMin: d.intervaloMin,
        },
      });
      if (count === 0) {
        throw new NaoEncontrado();
      }
    },

    async trocarSlug(ctx, novo) {
      const salaoId = exigirEscopo(ctx);
      const inserido = await db.$queryRaw<{ slug: string }[]>`
        INSERT INTO salao_slug (slug, salao_id, atual) VALUES (${novo}::text, ${salaoId}::uuid, false)
        ON CONFLICT (slug) DO NOTHING RETURNING slug`;
      if (inserido.length === 0) {
        const dono = await db.$queryRaw<{ salao_id: string }[]>`
          SELECT salao_id::text AS salao_id FROM salao_slug WHERE slug = ${novo}::text`;
        if (dono[0]?.salao_id !== salaoId) {
          return 'em_uso';
        }
      }
      const rebaixados = await db.$executeRaw`
        UPDATE salao_slug SET atual = false WHERE salao_id = ${salaoId}::uuid AND atual`;
      if (rebaixados !== 1) {
        throw new Error(`troca de slug: ${rebaixados} slug(s) atual(is) rebaixado(s); esperado 1`);
      }
      const promovidos = await db.$executeRaw`
        UPDATE salao_slug SET atual = true WHERE salao_id = ${salaoId}::uuid AND slug = ${novo}::text`;
      if (promovidos !== 1) {
        throw new Error(`troca de slug: ${promovidos} slug(s) promovido(s); esperado 1`);
      }
      return 'trocado';
    },
  };
}
