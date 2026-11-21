import { LIMITES_FOTO } from '@/server/fotos/tipos';
import type { FotoDoPainel } from '@/server/fotos/tipos';
import type { ContextoEscopado } from '@/server/tenant/context';
import { exigirEscopo } from '@/server/tenant/context';
import { NaoEncontrado } from '@/server/tenant/erros';

import { ehUuid } from './ids';
import type { Executor } from './transacao';

// Repositório das fotos do salão (D-021 §3.5). Todo método chama exigirEscopo(ctx): o salao_id vem só
// do contexto; fotoId que não é UUID → NaoEncontrado sem consultar.
//
// TRAVA: toda mudança de lista (inserir, mover, remover) acontece sob `salao … FOR NO KEY UPDATE`
// (`Repos.saloes.travar`, chamada pelo serviço antes destes métodos), na mesma transação. Ordem
// canônica: salao (FOR NO KEY UPDATE) → salao_foto. `inserirNoFim`, `trocarComVizinha` e
// `removerCompactando` EXIGEM estar dentro de emTransacao sob essa trava (como jornada.ts).
// salao_foto_posicao_unica é DEFERRABLE INITIALLY DEFERRED (dba.md): a troca e a compactação passam
// por estados intermediários repetidos que só são conferidos no commit. Nunca captura 23505 (A-14).

export type DadosNovaFoto = {
  chave: string;
  alt: string;
  largura: number;
  altura: number;
  bytes: number;
  envio: string;
};

export type ResultadoInserirFoto =
  | { resultado: 'criada'; id: string; posicao: number }
  | { resultado: 'duplicado' }
  | { resultado: 'limite' };

export interface RepoFoto {
  /** Fotos do salão por posição (colunas explícitas, sem chave). */
  listar(ctx: ContextoEscopado): Promise<FotoDoPainel[]>;
  /** Contagem e existência do token, num comando, sem trava (pré-checagem do envio). */
  prechecar(ctx: ContextoEscopado, envio: string): Promise<{ contagem: number; tokenExiste: boolean }>;
  /** Sob a trava: token existente → duplicado; contagem ≥ 12 → limite; senão INSERT em contagem + 1. */
  inserirNoFim(ctx: ContextoEscopado, d: DadosNovaFoto): Promise<ResultadoInserirFoto>;
  /** `igual` não escreve; foto inexistente no salão → NaoEncontrado. */
  editarAlt(ctx: ContextoEscopado, fotoId: string, alt: string): Promise<'alterada' | 'igual'>;
  /** Troca com a vizinha em UM UPDATE; posição divergente → ordem_mudou; sem vizinha → na_ponta. */
  trocarComVizinha(
    ctx: ContextoEscopado,
    fotoId: string,
    direcao: 'cima' | 'baixo',
    posicaoEsperada: number,
  ): Promise<'movida' | 'ordem_mudou' | 'na_ponta'>;
  /** DELETE … RETURNING e compactação (posicao - 1 nas seguintes). Inexistente → NaoEncontrado. */
  removerCompactando(ctx: ContextoEscopado, fotoId: string): Promise<{ chave: string }>;
}

type LinhaPainel = { id: string; posicao: number; alt: string; largura: number; altura: number };

function exigirFoto(id: string): void {
  if (!ehUuid(id)) {
    throw new NaoEncontrado();
  }
}

export function criarRepoFoto(db: Executor): RepoFoto {
  async function prechecar(ctx: ContextoEscopado, envio: string) {
    const salaoId = exigirEscopo(ctx);
    const linhas = await db.$queryRaw<{ contagem: number; token_existe: boolean }[]>`
      SELECT count(*)::int AS contagem, COALESCE(bool_or(envio = ${envio}::uuid), false) AS token_existe
        FROM salao_foto
       WHERE salao_id = ${salaoId}::uuid`;
    return { contagem: linhas[0].contagem, tokenExiste: linhas[0].token_existe };
  }

  return {
    async listar(ctx) {
      const salaoId = exigirEscopo(ctx);
      return db.$queryRaw<LinhaPainel[]>`
        SELECT id::text AS id, posicao, alt, largura, altura
          FROM salao_foto
         WHERE salao_id = ${salaoId}::uuid
         ORDER BY posicao`;
    },

    prechecar,

    async inserirNoFim(ctx, d) {
      const salaoId = exigirEscopo(ctx);
      const { contagem, tokenExiste } = await prechecar(ctx, d.envio);
      if (tokenExiste) {
        return { resultado: 'duplicado' };
      }
      if (contagem >= LIMITES_FOTO.maxFotos) {
        return { resultado: 'limite' };
      }
      const posicao = contagem + 1;
      const linhas = await db.$queryRaw<{ id: string }[]>`
        INSERT INTO salao_foto (salao_id, chave, alt, posicao, largura, altura, bytes, envio)
        VALUES (${salaoId}::uuid, ${d.chave}, ${d.alt}, ${posicao}, ${d.largura}, ${d.altura}, ${d.bytes}, ${d.envio}::uuid)
        RETURNING id::text AS id`;
      return { resultado: 'criada', id: linhas[0].id, posicao };
    },

    async editarAlt(ctx, fotoId, alt) {
      const salaoId = exigirEscopo(ctx);
      exigirFoto(fotoId);
      const alterada = await db.$executeRaw`
        UPDATE salao_foto SET alt = ${alt}
         WHERE salao_id = ${salaoId}::uuid AND id = ${fotoId}::uuid AND alt IS DISTINCT FROM ${alt}`;
      if (alterada > 0) {
        return 'alterada';
      }
      const existe = await db.$queryRaw<{ id: string }[]>`
        SELECT id::text AS id FROM salao_foto WHERE salao_id = ${salaoId}::uuid AND id = ${fotoId}::uuid`;
      if (existe.length === 0) {
        throw new NaoEncontrado();
      }
      return 'igual';
    },

    async trocarComVizinha(ctx, fotoId, direcao, posicaoEsperada) {
      const salaoId = exigirEscopo(ctx);
      exigirFoto(fotoId);
      const atual = await db.$queryRaw<{ posicao: number }[]>`
        SELECT posicao FROM salao_foto WHERE salao_id = ${salaoId}::uuid AND id = ${fotoId}::uuid`;
      if (atual.length === 0) {
        throw new NaoEncontrado();
      }
      const posicao = atual[0].posicao;
      if (posicao !== posicaoEsperada) {
        return 'ordem_mudou';
      }
      const alvo = direcao === 'cima' ? posicao - 1 : posicao + 1;
      const vizinha = await db.$queryRaw<{ id: string }[]>`
        SELECT id::text AS id FROM salao_foto WHERE salao_id = ${salaoId}::uuid AND posicao = ${alvo}`;
      if (vizinha.length === 0) {
        return 'na_ponta';
      }
      await db.$executeRaw`
        UPDATE salao_foto
           SET posicao = CASE WHEN id = ${fotoId}::uuid THEN ${alvo}::int ELSE ${posicao}::int END
         WHERE salao_id = ${salaoId}::uuid AND id IN (${fotoId}::uuid, ${vizinha[0].id}::uuid)`;
      return 'movida';
    },

    async removerCompactando(ctx, fotoId) {
      const salaoId = exigirEscopo(ctx);
      exigirFoto(fotoId);
      const removidas = await db.$queryRaw<{ chave: string; posicao: number }[]>`
        DELETE FROM salao_foto
         WHERE salao_id = ${salaoId}::uuid AND id = ${fotoId}::uuid
        RETURNING chave, posicao`;
      if (removidas.length === 0) {
        throw new NaoEncontrado();
      }
      await db.$executeRaw`
        UPDATE salao_foto SET posicao = posicao - 1
         WHERE salao_id = ${salaoId}::uuid AND posicao > ${removidas[0].posicao}`;
      return { chave: removidas[0].chave };
    },
  };
}
