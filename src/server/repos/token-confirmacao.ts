import { Prisma } from '@/generated/prisma/client';
import type { Papel } from '@/server/tenant/context';

import { obterPrisma } from './db';

// Tokens de confirmação de e-mail (D-011 §3.2; RN-13, RN-14). Repositório PRÉ-CONTEXTO: exceção
// documentada à RN-8 da D-005 (como sessao.ts): quem abre o link ou pede o reenvio não tem sessão.
// Recebe só o HASH do token (nunca o valor em claro) e nunca devolve `token_hash` nem `senha_hash`.
// Ordem de travas fixa nas duas funções que mexem em token existente: linha de `usuario` (FOR
// UPDATE) primeiro, depois `token` (R-1: sem impasse; consumo × reenvio serializam no usuário).
// As regras de validade usam o `agora` recebido (relógio injetado), nunca o now() do banco.

export type AlvoReenvio = {
  usuarioId: string;
  email: string;
  nome: string;
  nomeSalao: string | null;
  papel: Papel;
  confirmado: boolean;
};

type LinhaAlvo = {
  usuario_id: string;
  email: string;
  nome: string;
  nome_salao: string | null;
  papel: Papel;
  confirmado: boolean;
};

const paraAlvo = (l: LinhaAlvo): AlvoReenvio => ({
  usuarioId: l.usuario_id,
  email: l.email,
  nome: l.nome,
  nomeSalao: l.nome_salao,
  papel: l.papel,
  confirmado: l.confirmado,
});

/** Usuário (de qualquer papel) pelo e-mail já normalizado, para o reenvio. */
export async function buscarAlvoPorEmail(email: string): Promise<AlvoReenvio | null> {
  const [linha] = await obterPrisma().$queryRaw<LinhaAlvo[]>`
    SELECT u.id::text AS usuario_id, u.email, u.nome, s.nome AS nome_salao, u.papel::text AS papel,
           (u.email_confirmado_em IS NOT NULL) AS confirmado
      FROM usuario u
      LEFT JOIN salao s ON s.id = u.salao_id
     WHERE u.email = ${email}::text`;
  return linha ? paraAlvo(linha) : null;
}

/** Dono de um token `confirmacao_email` (em qualquer estado: usado, expirado, invalidado). Outro tipo → null. */
export async function buscarAlvoPorTokenHash(tokenHash: string): Promise<AlvoReenvio | null> {
  const [linha] = await obterPrisma().$queryRaw<LinhaAlvo[]>`
    SELECT u.id::text AS usuario_id, u.email, u.nome, s.nome AS nome_salao, u.papel::text AS papel,
           (u.email_confirmado_em IS NOT NULL) AS confirmado
      FROM token t
      JOIN usuario u ON u.id = t.usuario_id
      LEFT JOIN salao s ON s.id = u.salao_id
     WHERE t.token_hash = ${tokenHash}::text AND t.tipo = 'confirmacao_email'::tipo_token`;
  return linha ? paraAlvo(linha) : null;
}

export type ResultadoConsumo = 'confirmado' | 'ja_utilizado' | 'expirado_ou_substituido' | 'invalido';

const ISOLAMENTO = { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted };

/**
 * RN-13; CA-4, CA-5, CA-14. Uma transação: trava o usuário dono do token, consome o token com um
 * UPDATE condicional (uso único, dentro da validade), confirma o e-mail (se ainda nulo) e invalida
 * os demais tokens de confirmação pendentes do usuário. Token de outro tipo ou de usuário que não é
 * gestor (D-8) → 'invalido'.
 */
export async function consumirTokenConfirmacao(tokenHash: string, agora: Date): Promise<ResultadoConsumo> {
  return obterPrisma().$transaction(async (tx) => {
    const [token] = await tx.$queryRaw<{ usuario_id: string; tipo: string }[]>`
      SELECT usuario_id::text AS usuario_id, tipo::text AS tipo FROM token WHERE token_hash = ${tokenHash}::text`;
    if (!token || token.tipo !== 'confirmacao_email') {
      return 'invalido';
    }
    const [usuario] = await tx.$queryRaw<{ papel: string }[]>`
      SELECT papel::text AS papel FROM usuario WHERE id = ${token.usuario_id}::uuid FOR UPDATE`;
    if (usuario.papel !== 'gestor') {
      return 'invalido';
    }
    const consumido = await tx.$executeRaw`
      UPDATE token SET usado_em = ${agora}::timestamptz
       WHERE token_hash = ${tokenHash}::text
         AND usado_em IS NULL AND invalidado_em IS NULL AND expira_em > ${agora}::timestamptz`;
    if (consumido === 0) {
      const [estado] = await tx.$queryRaw<{ usado: boolean }[]>`
        SELECT (usado_em IS NOT NULL) AS usado FROM token WHERE token_hash = ${tokenHash}::text`;
      return estado.usado ? 'ja_utilizado' : 'expirado_ou_substituido';
    }
    await tx.$executeRaw`
      UPDATE usuario SET email_confirmado_em = ${agora}::timestamptz, atualizado_em = ${agora}::timestamptz
       WHERE id = ${token.usuario_id}::uuid AND email_confirmado_em IS NULL`;
    await tx.$executeRaw`
      UPDATE token SET invalidado_em = ${agora}::timestamptz
       WHERE usuario_id = ${token.usuario_id}::uuid AND tipo = 'confirmacao_email'::tipo_token
         AND usado_em IS NULL AND invalidado_em IS NULL`;
    return 'confirmado';
  }, ISOLAMENTO);
}

/**
 * RN-14; CA-5, CA-15. Uma transação: trava o usuário; se for gestor ainda não confirmado, invalida
 * os tokens de confirmação pendentes (inclusive os já vencidos) e grava o novo. 'nao_aplicavel' =
 * já confirmado ou não é gestor (por exemplo, o consumo venceu a corrida).
 */
export async function substituirTokenConfirmacao(d: {
  usuarioId: string;
  tokenHash: string;
  expiraEm: Date;
  agora: Date;
}): Promise<'emitido' | 'nao_aplicavel'> {
  return obterPrisma().$transaction(async (tx) => {
    const [usuario] = await tx.$queryRaw<{ papel: string; confirmado: boolean }[]>`
      SELECT papel::text AS papel, (email_confirmado_em IS NOT NULL) AS confirmado
        FROM usuario WHERE id = ${d.usuarioId}::uuid FOR UPDATE`;
    if (!usuario || usuario.papel !== 'gestor' || usuario.confirmado) {
      return 'nao_aplicavel';
    }
    await tx.$executeRaw`
      UPDATE token SET invalidado_em = ${d.agora}::timestamptz
       WHERE usuario_id = ${d.usuarioId}::uuid AND tipo = 'confirmacao_email'::tipo_token
         AND usado_em IS NULL AND invalidado_em IS NULL`;
    await tx.$executeRaw`
      INSERT INTO token (usuario_id, tipo, token_hash, expira_em, criado_em)
      VALUES (${d.usuarioId}::uuid, 'confirmacao_email'::tipo_token, ${d.tokenHash}::text,
              ${d.expiraEm}::timestamptz, ${d.agora}::timestamptz)`;
    return 'emitido';
  }, ISOLAMENTO);
}
