import { Prisma } from '@/generated/prisma/client';
import type { Papel } from '@/server/tenant/context';

import { obterPrisma } from './db';

// Tokens de recuperação de senha (D-012 §3.1; RN-5, RN-9..RN-12, D-3, D-8). Repositório
// PRÉ-CONTEXTO: exceção documentada à RN-8 da D-005 (como sessao.ts e token-confirmacao.ts): quem
// pede o link ou redefine a senha não tem sessão. Recebe só o HASH do token (nunca o valor em
// claro) e nenhum DTO devolve `token_hash` nem `senha_hash`. Ordem de travas fixa em todas as
// funções que escrevem: `usuario` (FOR UPDATE) → `token` → `sessao` → `rate_limit_janela` (a mesma
// da D-011; sem impasse). As regras de validade usam o `agora` recebido (relógio injetado), nunca o
// now() do banco. A regra de elegibilidade é do serviço e chega aqui como predicado.

/** Dados de elegibilidade (RN-6). profissionalAtivo: `ativo` do perfil vinculado; null = sem perfil. */
export type PerfilElegibilidade = { papel: Papel; profissionalAtivo: boolean | null };
export type Elegibilidade = (u: PerfilElegibilidade) => boolean;

export type AlvoRecuperacao = PerfilElegibilidade & { usuarioId: string; email: string; nome: string };

export type TokenRecuperacao = AlvoRecuperacao & { usadoEm: Date | null; invalidadoEm: Date | null; expiraEm: Date };

type LinhaAlvo = {
  usuario_id: string;
  email: string;
  nome: string;
  papel: Papel;
  profissional_ativo: boolean | null;
};

const paraAlvo = (l: LinhaAlvo): AlvoRecuperacao => ({
  usuarioId: l.usuario_id,
  email: l.email,
  nome: l.nome,
  papel: l.papel,
  profissionalAtivo: l.profissional_ativo,
});

const ISOLAMENTO = { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted };

/** Usuário (qualquer papel) pelo e-mail já normalizado; LEFT JOIN no perfil de profissional vinculado. */
export async function buscarAlvoRecuperacao(email: string): Promise<AlvoRecuperacao | null> {
  const [linha] = await obterPrisma().$queryRaw<LinhaAlvo[]>`
    SELECT u.id::text AS usuario_id, u.email, u.nome, u.papel::text AS papel, p.ativo AS profissional_ativo
      FROM usuario u
      LEFT JOIN profissional p ON p.usuario_id = u.id
     WHERE u.email = ${email}::text`;
  return linha ? paraAlvo(linha) : null;
}

/** Só leitura, sem trava e sem escrita (GET do link, D-1). Só tipo 'recuperacao_senha' (outro tipo → null). */
export async function buscarTokenRecuperacao(tokenHash: string): Promise<TokenRecuperacao | null> {
  const [linha] = await obterPrisma().$queryRaw<
    (LinhaAlvo & { usado_em: Date | null; invalidado_em: Date | null; expira_em: Date })[]
  >`
    SELECT u.id::text AS usuario_id, u.email, u.nome, u.papel::text AS papel, p.ativo AS profissional_ativo,
           t.usado_em, t.invalidado_em, t.expira_em
      FROM token t
      JOIN usuario u ON u.id = t.usuario_id
      LEFT JOIN profissional p ON p.usuario_id = u.id
     WHERE t.token_hash = ${tokenHash}::text AND t.tipo = 'recuperacao_senha'::tipo_token`;
  if (!linha) {
    return null;
  }
  return { ...paraAlvo(linha), usadoEm: linha.usado_em, invalidadoEm: linha.invalidado_em, expiraEm: linha.expira_em };
}

type Transacao = Prisma.TransactionClient;

/** Trava a linha do usuário (FOR UPDATE OF u) e devolve o perfil de elegibilidade; null se não existe. */
async function travarUsuario(tx: Transacao, usuarioId: string): Promise<PerfilElegibilidade | null> {
  const [linha] = await tx.$queryRaw<{ papel: Papel; profissional_ativo: boolean | null }[]>`
    SELECT u.papel::text AS papel, p.ativo AS profissional_ativo
      FROM usuario u
      LEFT JOIN profissional p ON p.usuario_id = u.id
     WHERE u.id = ${usuarioId}::uuid
       FOR UPDATE OF u`;
  return linha ? { papel: linha.papel, profissionalAtivo: linha.profissional_ativo } : null;
}

/**
 * RN-9, RN-12. Uma transação: trava o usuário; se elegível, invalida todos os tokens de recuperação
 * pendentes dele (vencidos ou não; os de confirmação ficam intocados) e grava o novo.
 * 'nao_aplicavel' = usuário ausente ou não elegível (nada gravado).
 */
export async function emitirTokenRecuperacao(d: {
  usuarioId: string;
  tokenHash: string;
  expiraEm: Date;
  agora: Date;
  elegivel: Elegibilidade;
}): Promise<'emitido' | 'nao_aplicavel'> {
  return obterPrisma().$transaction(async (tx) => {
    const perfil = await travarUsuario(tx, d.usuarioId);
    if (!perfil || !d.elegivel(perfil)) {
      return 'nao_aplicavel';
    }
    await tx.$executeRaw`
      UPDATE token SET invalidado_em = ${d.agora}::timestamptz
       WHERE usuario_id = ${d.usuarioId}::uuid AND tipo = 'recuperacao_senha'::tipo_token
         AND usado_em IS NULL AND invalidado_em IS NULL`;
    await tx.$executeRaw`
      INSERT INTO token (usuario_id, tipo, token_hash, expira_em, criado_em)
      VALUES (${d.usuarioId}::uuid, 'recuperacao_senha'::tipo_token, ${d.tokenHash}::text,
              ${d.expiraEm}::timestamptz, ${d.agora}::timestamptz)`;
    return 'emitido';
  }, ISOLAMENTO);
}

export type ResultadoRedefinicaoRepo =
  | { resultado: 'redefinido'; usuarioId: string; sessoesRevogadas: number }
  | { resultado: 'invalido' | 'ja_utilizado' | 'expirado_ou_substituido' | 'inelegivel' };

/**
 * RN-11, RN-12, D-3, D-8. Uma transação; qualquer erro desfaz tudo e é relançado. Trava o dono do
 * token, recheca a elegibilidade, consome o token (UPDATE condicional: uso único, dentro da
 * validade, não substituído), grava o novo hash (confirmando o e-mail se ainda nulo), invalida os
 * demais tokens pendentes de recuperação e de confirmação, revoga todas as sessões do usuário e
 * apaga a janela vigente do limite de login do e-mail. O hash da senha vem pronto (calculado fora).
 */
export async function redefinirSenhaComToken(d: {
  tokenHash: string;
  senhaHash: string;
  agora: Date;
  chaveLogin: string;
  janelaLogin: Date;
  elegivel: Elegibilidade;
}): Promise<ResultadoRedefinicaoRepo> {
  return obterPrisma().$transaction(async (tx): Promise<ResultadoRedefinicaoRepo> => {
    const [token] = await tx.$queryRaw<{ usuario_id: string; tipo: string }[]>`
      SELECT usuario_id::text AS usuario_id, tipo::text AS tipo FROM token WHERE token_hash = ${d.tokenHash}::text`;
    if (!token || token.tipo !== 'recuperacao_senha') {
      return { resultado: 'invalido' };
    }
    const usuarioId = token.usuario_id;
    const perfil = await travarUsuario(tx, usuarioId);
    // A FK garante o usuário; a checagem vem ANTES do consumo (nada a desfazer).
    if (!perfil || !d.elegivel(perfil)) {
      return { resultado: 'inelegivel' };
    }
    const consumido = await tx.$executeRaw`
      UPDATE token SET usado_em = ${d.agora}::timestamptz
       WHERE token_hash = ${d.tokenHash}::text AND tipo = 'recuperacao_senha'::tipo_token
         AND usado_em IS NULL AND invalidado_em IS NULL AND expira_em > ${d.agora}::timestamptz`;
    if (consumido === 0) {
      const [estado] = await tx.$queryRaw<{ usado: boolean }[]>`
        SELECT (usado_em IS NOT NULL) AS usado FROM token WHERE token_hash = ${d.tokenHash}::text`;
      return { resultado: estado.usado ? 'ja_utilizado' : 'expirado_ou_substituido' };
    }
    await tx.$executeRaw`
      UPDATE usuario
         SET senha_hash = ${d.senhaHash}::text,
             atualizado_em = ${d.agora}::timestamptz,
             email_confirmado_em = COALESCE(email_confirmado_em, ${d.agora}::timestamptz)
       WHERE id = ${usuarioId}::uuid`;
    await tx.$executeRaw`
      UPDATE token SET invalidado_em = ${d.agora}::timestamptz
       WHERE usuario_id = ${usuarioId}::uuid
         AND tipo IN ('recuperacao_senha'::tipo_token, 'confirmacao_email'::tipo_token)
         AND usado_em IS NULL AND invalidado_em IS NULL`;
    const sessoesRevogadas = await tx.$executeRaw`
      UPDATE sessao SET revogada_em = ${d.agora}::timestamptz
       WHERE usuario_id = ${usuarioId}::uuid AND revogada_em IS NULL`;
    await tx.$executeRaw`
      DELETE FROM rate_limit_janela
       WHERE chave = ${d.chaveLogin}::text AND janela_inicio = ${d.janelaLogin}::timestamptz`;
    return { resultado: 'redefinido', usuarioId, sessoesRevogadas };
  }, ISOLAMENTO);
}
