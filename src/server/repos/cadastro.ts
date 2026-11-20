import { escolherSlugLivre } from '@/lib/slug';
import { Prisma } from '@/generated/prisma/client';

import { obterPrisma } from './db';

// Cadastro de salão + gestor (D-011 §3.2). Repositório PRÉ-CONTEXTO: exceção documentada à RN-8 da
// D-005 (como sessao.ts e rate-limit.ts): ainda não há sessão nem salão, e as tabelas tocadas para
// decidir unicidade (`usuario.email`, `salao_slug.slug`) são globais. Nenhum valor de `salao_id`
// vem do chamador: o salão é criado aqui. Unicidade sob concorrência por `INSERT … ON CONFLICT …
// DO NOTHING RETURNING` (D-16): nunca captura violação de constraint e nunca aborta a transação.

/** Rodadas do laço de escolha do slug (RN-11). */
export const RODADAS_SLUG_PADRAO = 5;

/** Verificação prévia (sem trava): só evita o custo do argon2 quando o e-mail já existe (RN-11). */
export async function emailJaCadastrado(email: string): Promise<boolean> {
  const u = await obterPrisma().usuario.findUnique({ where: { email }, select: { id: true } });
  return u !== null;
}

export type NovoCadastro = {
  nomeSalao: string;
  /** Já no formato do CHECK (slugBase). */
  slugBase: string;
  nomeGestor: string;
  /** Já minúsculo. */
  email: string;
  /** Calculado fora da transação. */
  senhaHash: string;
  tokenHash: string;
  expiraEm: Date;
  agora: Date;
  /** Rodadas do laço de slug (padrão 5, RN-11). Só os testes informam (0 cobre `slug_esgotado`). */
  maxRodadasSlug?: number;
};

export type ResultadoCriacao =
  | { ok: true; salaoId: string; usuarioId: string; slug: string }
  | { ok: false; motivo: 'email_existente' | 'slug_esgotado' };

/** Sentinelas internos: lançados dentro da transação para desfazê-la; nunca saem deste módulo. */
class EmailExistente extends Error {}
class SlugEsgotado extends Error {}

/**
 * CA-1, CA-2, CA-3, CA-7, CA-11..CA-13. Uma transação READ COMMITTED: salão → gestor (ON CONFLICT
 * no e-mail; sem linha, desfaz tudo) → slug atual (laço de candidatos com ON CONFLICT na PK) →
 * token de confirmação. Qualquer outro erro desfaz tudo e é relançado.
 */
export async function criarSalaoComGestor(d: NovoCadastro): Promise<ResultadoCriacao> {
  const rodadas = d.maxRodadasSlug ?? RODADAS_SLUG_PADRAO;
  try {
    return await obterPrisma().$transaction(
      async (tx) => {
        // 1. Salão: as configurações da RN-3 vêm dos defaults do banco.
        const [salao] = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO salao (nome) VALUES (${d.nomeSalao}::text) RETURNING id::text AS id`;

        // 2. Gestor. Com duplo envio, a segunda transação espera a primeira no índice único e,
        //    após o commit dela, não recebe linha (CA-11).
        const usuarios = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO usuario (salao_id, papel, email, nome, senha_hash)
          VALUES (${salao.id}::uuid, 'gestor'::papel_usuario, ${d.email}::text, ${d.nomeGestor}::text,
                  ${d.senhaHash}::text)
          ON CONFLICT (email) DO NOTHING
          RETURNING id::text AS id`;
        if (usuarios.length === 0) {
          throw new EmailExistente();
        }
        const usuarioId = usuarios[0].id;

        // 3. Slug atual: o candidato pode ser gravado por outro cadastro entre o SELECT e o INSERT;
        //    nesse caso, nova rodada (o SELECT seguinte, em READ COMMITTED, vê o commit concorrente).
        //    O LIKE não precisa de escape: a base casa o formato do slug (sem `_` nem `%`).
        let slug: string | null = null;
        for (let i = 0; i < rodadas && slug === null; i++) {
          const linhas = await tx.$queryRaw<{ slug: string }[]>`
            SELECT slug FROM salao_slug
             WHERE slug = ${d.slugBase}::text OR slug LIKE ${d.slugBase + '-%'}::text`;
          const candidato = escolherSlugLivre(d.slugBase, new Set(linhas.map((l) => l.slug)));
          const gravado = await tx.$queryRaw<{ slug: string }[]>`
            INSERT INTO salao_slug (slug, salao_id, atual)
            VALUES (${candidato}::text, ${salao.id}::uuid, true)
            ON CONFLICT (slug) DO NOTHING
            RETURNING slug`;
          slug = gravado[0]?.slug ?? null;
        }
        if (slug === null) {
          throw new SlugEsgotado();
        }

        // 4. Token de confirmação (só o hash).
        await tx.$executeRaw`
          INSERT INTO token (usuario_id, tipo, token_hash, expira_em, criado_em)
          VALUES (${usuarioId}::uuid, 'confirmacao_email'::tipo_token, ${d.tokenHash}::text,
                  ${d.expiraEm}::timestamptz, ${d.agora}::timestamptz)`;

        return { ok: true as const, salaoId: salao.id, usuarioId, slug };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  } catch (e) {
    if (e instanceof EmailExistente) {
      return { ok: false, motivo: 'email_existente' };
    }
    if (e instanceof SlugEsgotado) {
      return { ok: false, motivo: 'slug_esgotado' };
    }
    throw e;
  }
}
