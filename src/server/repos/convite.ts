import type { ContextoEscopado } from '@/server/tenant/context';
import { exigirEscopo } from '@/server/tenant/context';
import { NaoEncontrado } from '@/server/tenant/erros';

import { ehUuid } from './ids';
import type { Executor } from './transacao';

// Repositório de convites de profissional, escopado ao salão (D-039 §2). Todo método filtra pelo salão
// do contexto; nenhum DTO devolve `token_hash`. O aceite (pré-contexto) fica em convite-publico.ts.
//
// ORDEM DE TRAVAS (D-039 §3; vale para convidar, aceitar e editar o e-mail):
//   `salao` (se usado) → `profissional` (FOR NO KEY UPDATE no envio; FOR UPDATE no aceite e nas
//   alterações de D-013) → `convite` → `usuario` → `rate_limit_janela`.
// Nunca travar `usuario` antes do profissional. O índice parcial `convite_pendente_por_profissional_uniq`
// é só cinto: convidar SEMPRE invalida os pendentes antes de inserir; uma violação dele (23505) é erro de
// ordem de travas e NUNCA é capturada.

export type TravaParaConvite = {
  id: string;
  ativo: boolean;
  /** E-mail do perfil, como gravado (o serviço normaliza). */
  email: string | null;
  usuarioId: string | null;
  nome: string;
  nomeSalao: string | null;
};

export type UltimoConvite = {
  profissionalId: string;
  aceitoEm: Date | null;
  invalidadoEm: Date | null;
  expiraEm: Date;
  fusoSalao: string;
};

export interface RepoConvite {
  /** `SELECT … FOR NO KEY UPDATE OF p` do profissional do salão. Sem linha ou id malformado → NaoEncontrado. */
  travarProfissionalParaConvite(ctx: ContextoEscopado, id: string): Promise<TravaParaConvite>;
  /** Existe `usuario` com este e-mail (qualquer salão e papel)? Leitura simples, e-mail já normalizado. */
  emailEmUso(ctx: ContextoEscopado, email: string): Promise<boolean>;
  /** Marca como invalidados os convites pendentes (vencidos ou não) do profissional. Devolve quantos. */
  invalidarPendentes(ctx: ContextoEscopado, profissionalId: string, agora: Date): Promise<number>;
  inserir(
    ctx: ContextoEscopado,
    d: { profissionalId: string; email: string; tokenHash: string; expiraEm: Date; agora: Date },
  ): Promise<void>;
  /** Incremento atômico da janela, NA transação corrente. Devolve o contador depois do incremento. */
  contarEnvioNaJanela(chave: string, janelaInicio: Date): Promise<number>;
  /** O convite mais recente de cada profissional (só estado e datas). */
  ultimoPorProfissional(ctx: ContextoEscopado, ids: readonly string[]): Promise<UltimoConvite[]>;
}

export function criarRepoConvite(db: Executor): RepoConvite {
  return {
    async travarProfissionalParaConvite(ctx, id) {
      const salaoId = exigirEscopo(ctx);
      if (!ehUuid(id)) {
        throw new NaoEncontrado();
      }
      const [l] = await db.$queryRaw<
        { id: string; ativo: boolean; email: string | null; usuario_id: string | null; nome: string; nome_salao: string | null }[]
      >`
        SELECT p.id::text AS id, p.ativo, p.email, p.usuario_id::text AS usuario_id, p.nome, s.nome AS nome_salao
          FROM profissional p
          JOIN salao s ON s.id = p.salao_id
         WHERE p.id = ${id}::uuid AND p.salao_id = ${salaoId}::uuid
           FOR NO KEY UPDATE OF p`;
      if (!l) {
        throw new NaoEncontrado();
      }
      return { id: l.id, ativo: l.ativo, email: l.email, usuarioId: l.usuario_id, nome: l.nome, nomeSalao: l.nome_salao };
    },

    async emailEmUso(ctx, email) {
      exigirEscopo(ctx);
      const linhas = await db.$queryRaw<{ um: number }[]>`
        SELECT 1 AS um FROM usuario WHERE email = lower(${email}::text) LIMIT 1`;
      return linhas.length > 0;
    },

    async invalidarPendentes(ctx, profissionalId, agora) {
      const salaoId = exigirEscopo(ctx);
      if (!ehUuid(profissionalId)) {
        return 0;
      }
      return db.$executeRaw`
        UPDATE convite SET invalidado_em = ${agora}::timestamptz
         WHERE salao_id = ${salaoId}::uuid AND profissional_id = ${profissionalId}::uuid
           AND aceito_em IS NULL AND invalidado_em IS NULL`;
    },

    async inserir(ctx, d) {
      const salaoId = exigirEscopo(ctx);
      await db.$executeRaw`
        INSERT INTO convite (salao_id, profissional_id, email, token_hash, expira_em, criado_em)
        VALUES (${salaoId}::uuid, ${d.profissionalId}::uuid, ${d.email}::text, ${d.tokenHash}::text,
                ${d.expiraEm}::timestamptz, ${d.agora}::timestamptz)`;
    },

    async contarEnvioNaJanela(chave, janelaInicio) {
      const [l] = await db.$queryRaw<{ contador: number }[]>`
        INSERT INTO rate_limit_janela (chave, janela_inicio, contador)
        VALUES (${chave}::text, ${janelaInicio}::timestamptz, 1)
        ON CONFLICT (chave, janela_inicio)
        DO UPDATE SET contador = rate_limit_janela.contador + 1
        RETURNING contador`;
      return l.contador;
    },

    async ultimoPorProfissional(ctx, ids) {
      const salaoId = exigirEscopo(ctx);
      const validos = ids.filter(ehUuid);
      if (validos.length === 0) {
        return [];
      }
      const linhas = await db.$queryRaw<
        { profissional_id: string; aceito_em: Date | null; invalidado_em: Date | null; expira_em: Date; fuso: string }[]
      >`
        SELECT DISTINCT ON (c.profissional_id)
               c.profissional_id::text AS profissional_id, c.aceito_em, c.invalidado_em, c.expira_em, s.fuso
          FROM convite c
          JOIN salao s ON s.id = c.salao_id
         WHERE c.salao_id = ${salaoId}::uuid AND c.profissional_id = ANY(${validos}::uuid[])
         ORDER BY c.profissional_id, c.criado_em DESC, c.id DESC`;
      return linhas.map((l) => ({
        profissionalId: l.profissional_id,
        aceitoEm: l.aceito_em,
        invalidadoEm: l.invalidado_em,
        expiraEm: l.expira_em,
        fusoSalao: l.fuso,
      }));
    },
  };
}
