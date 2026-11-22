import { Prisma } from '@/generated/prisma/client';

import { obterPrisma } from './db';

// Aceite do convite de profissional (D-039 §3). Repositório PRÉ-CONTEXTO: exceção documentada à RN-8 da
// D-005 (como token-recuperacao.ts e sessao.ts): quem aceita não tem sessão nem salão; o `salao_id` é
// derivado do convite, nunca da entrada. Recebe só o HASH do token; nenhum DTO devolve `token_hash` nem
// `senha_hash`. As regras de validade usam o `agora` injetado, nunca o now() do banco.
//
// ORDEM DE TRAVAS do aceite: `profissional` (FOR UPDATE; serializa com desativar, reenvio e edição) →
// `convite` (FOR UPDATE, relido) → `usuario` (INSERT … ON CONFLICT (email) DO NOTHING). Nunca captura
// 23505: e-mail já usado = 0 linhas devolvidas = recusa sem efeito.

export type ConviteVisto = {
  aceitoEm: Date | null;
  invalidadoEm: Date | null;
  expiraEm: Date;
  profissionalAtivo: boolean;
  profissionalTemUsuario: boolean;
  /** `convite.email` coincide com o e-mail atual do perfil (aparado e em minúsculas). */
  emailConfere: boolean;
};

/** Leitura sem trava e sem escrita (GET da página). Hash desconhecido → null. */
export async function buscarConvitePorHash(tokenHash: string): Promise<ConviteVisto | null> {
  const [l] = await obterPrisma().$queryRaw<
    {
      aceito_em: Date | null;
      invalidado_em: Date | null;
      expira_em: Date;
      ativo: boolean;
      usuario_id: string | null;
      confere: boolean;
    }[]
  >`
    SELECT c.aceito_em, c.invalidado_em, c.expira_em, p.ativo, p.usuario_id::text AS usuario_id,
           (c.email = lower(btrim(p.email))) AS confere
      FROM convite c
      JOIN profissional p ON p.salao_id = c.salao_id AND p.id = c.profissional_id
     WHERE c.token_hash = ${tokenHash}::text`;
  if (!l) {
    return null;
  }
  return {
    aceitoEm: l.aceito_em,
    invalidadoEm: l.invalidado_em,
    expiraEm: l.expira_em,
    profissionalAtivo: l.ativo,
    profissionalTemUsuario: l.usuario_id !== null,
    emailConfere: l.confere === true,
  };
}

export type MotivoRecusaDeAceite =
  | 'invalido'
  | 'ja_utilizado'
  | 'invalidado'
  | 'expirado'
  | 'profissional_inativo'
  | 'ja_vinculado'
  | 'email_divergente'
  | 'email_em_uso';

export type ResultadoAceiteRepo =
  | { resultado: 'aceito'; usuarioId: string; salaoId: string; profissionalId: string }
  | { resultado: MotivoRecusaDeAceite };

/**
 * Uma transação READ COMMITTED; qualquer erro desfaz tudo e é relançado. Confere as regras sob as
 * travas e só então cria o usuário, vincula o perfil e marca o convite. Sem sessão e sem cookie.
 */
export async function aceitarConvitePorHash(d: {
  tokenHash: string;
  senhaHash: string;
  agora: Date;
}): Promise<ResultadoAceiteRepo> {
  return obterPrisma().$transaction(
    async (tx): Promise<ResultadoAceiteRepo> => {
      const [previo] = await tx.$queryRaw<{ salao_id: string; profissional_id: string }[]>`
        SELECT salao_id::text AS salao_id, profissional_id::text AS profissional_id
          FROM convite WHERE token_hash = ${d.tokenHash}::text`;
      if (!previo) {
        return { resultado: 'invalido' };
      }
      const [p] = await tx.$queryRaw<
        { nome: string; ativo: boolean; usuario_id: string | null; email_norm: string | null }[]
      >`
        SELECT p.nome, p.ativo, p.usuario_id::text AS usuario_id, lower(btrim(p.email)) AS email_norm
          FROM profissional p
         WHERE p.id = ${previo.profissional_id}::uuid AND p.salao_id = ${previo.salao_id}::uuid
           FOR UPDATE OF p`;
      const [c] = await tx.$queryRaw<
        { id: string; email: string; aceito_em: Date | null; invalidado_em: Date | null; expira_em: Date }[]
      >`
        SELECT id::text AS id, email, aceito_em, invalidado_em, expira_em
          FROM convite WHERE token_hash = ${d.tokenHash}::text
           FOR UPDATE`;
      if (!p || !c) {
        return { resultado: 'invalido' };
      }
      if (c.aceito_em !== null) return { resultado: 'ja_utilizado' };
      if (c.invalidado_em !== null) return { resultado: 'invalidado' };
      if (d.agora.getTime() >= c.expira_em.getTime()) return { resultado: 'expirado' };
      if (!p.ativo) return { resultado: 'profissional_inativo' };
      if (p.usuario_id !== null) return { resultado: 'ja_vinculado' };
      if (p.email_norm !== c.email) return { resultado: 'email_divergente' };

      const criados = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO usuario (salao_id, papel, email, nome, senha_hash, email_confirmado_em, criado_em, atualizado_em)
        VALUES (${previo.salao_id}::uuid, 'profissional'::papel_usuario, ${c.email}::text, ${p.nome}::text,
                ${d.senhaHash}::text, ${d.agora}::timestamptz, ${d.agora}::timestamptz, ${d.agora}::timestamptz)
        ON CONFLICT (email) DO NOTHING
        RETURNING id::text AS id`;
      if (criados.length === 0) {
        return { resultado: 'email_em_uso' };
      }
      const usuarioId = criados[0].id;
      await tx.$executeRaw`
        UPDATE profissional SET usuario_id = ${usuarioId}::uuid, atualizado_em = ${d.agora}::timestamptz
         WHERE id = ${previo.profissional_id}::uuid AND salao_id = ${previo.salao_id}::uuid`;
      await tx.$executeRaw`
        UPDATE convite SET aceito_em = ${d.agora}::timestamptz WHERE id = ${c.id}::uuid`;
      return { resultado: 'aceito', usuarioId, salaoId: previo.salao_id, profissionalId: previo.profissional_id };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
  );
}
