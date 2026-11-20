import { Prisma } from '@/generated/prisma/client';
import type { Papel } from '@/server/tenant/context';

import { obterPrisma } from './db';

/**
 * Sessões da equipe (D-005 §3.2; D-010 §3.6). Exceção documentada à RN-8: é pré-contexto (ainda não
 * há salão), por isso recebe só o hash do token ou IDs, nunca o token em claro nem um salaoId.
 */
export type SessaoValida = {
  sessaoId: string;
  usuarioId: string;
  papel: Papel;
  salaoId: string | null;
  profissionalId: string | null;
  /** `ativo` do perfil vinculado; null = usuário sem perfil de profissional. */
  profissionalAtivo: boolean | null;
  totpVerificadoEm: Date | null;
  criadoEm: Date;
  ultimoUsoEm: Date | null;
};

/**
 * Sessão válida = `token_hash` igual, `expira_em > agora` (no limite, expirada) e não revogada.
 * `profissionalId`/`profissionalAtivo` vêm do perfil vinculado ao usuário (UNIQUE usuario_id); quem
 * decide o efeito de `ativo` é `resolverTenant` (D-010 RN-14).
 */
export async function buscarSessaoValida(tokenHash: string, agora: Date): Promise<SessaoValida | null> {
  const sessao = await obterPrisma().sessao.findFirst({
    where: { tokenHash, expiraEm: { gt: agora }, revogadaEm: null },
    select: {
      id: true,
      totpVerificadoEm: true,
      criadoEm: true,
      ultimoUsoEm: true,
      usuario: {
        select: {
          id: true,
          papel: true,
          salaoId: true,
          profissional: { select: { id: true, ativo: true } },
        },
      },
    },
  });
  if (!sessao) {
    return null;
  }
  const { usuario } = sessao;
  return {
    sessaoId: sessao.id,
    usuarioId: usuario.id,
    papel: usuario.papel,
    salaoId: usuario.salaoId,
    profissionalId: usuario.profissional?.id ?? null,
    profissionalAtivo: usuario.profissional?.ativo ?? null,
    totpVerificadoEm: sessao.totpVerificadoEm,
    criadoEm: sessao.criadoEm,
    ultimoUsoEm: sessao.ultimoUsoEm,
  };
}

/**
 * Nova sessão. `criado_em` e `ultimo_uso_em` recebem `agora` EXPLICITAMENTE (não o now() do banco):
 * o teto de 30 d conta a partir do relógio injetado (CA-14).
 */
export async function criarSessao(d: {
  usuarioId: string;
  tokenHash: string;
  agora: Date;
  expiraEm: Date;
}): Promise<void> {
  await obterPrisma().sessao.create({
    data: {
      usuarioId: d.usuarioId,
      tokenHash: d.tokenHash,
      expiraEm: d.expiraEm,
      criadoEm: d.agora,
      ultimoUsoEm: d.agora,
    },
    select: { id: true },
  });
}

/**
 * Cria a sessão SOMENTE se `usuario.senha_hash` ainda é `senhaHash` (o hash verificado pelo login;
 * D-012 RN-13, D-11). Uma transação: `SELECT … FOR SHARE` na linha do usuário com a condição no
 * hash (conflita com o UPDATE da redefinição de senha, ao contrário do FOR KEY SHARE da FK) e, se a
 * linha vier, o INSERT da sessão com os mesmos campos de `criarSessao`. false = a senha mudou desde a
 * verificação (nada gravado). A transação toca só `usuario` (compartilhada) e `sessao` (sem impasse).
 */
export async function criarSessaoSeSenhaVigente(d: {
  usuarioId: string;
  tokenHash: string;
  agora: Date;
  expiraEm: Date;
  senhaHash: string;
}): Promise<boolean> {
  return obterPrisma().$transaction(
    async (tx) => {
      const vigente = await tx.$queryRaw<{ ok: number }[]>`
        SELECT 1 AS ok FROM usuario WHERE id = ${d.usuarioId}::uuid AND senha_hash = ${d.senhaHash}::text FOR SHARE`;
      if (vigente.length === 0) {
        return false;
      }
      await tx.sessao.create({
        data: {
          usuarioId: d.usuarioId,
          tokenHash: d.tokenHash,
          expiraEm: d.expiraEm,
          criadoEm: d.agora,
          ultimoUsoEm: d.agora,
        },
        select: { id: true },
      });
      return true;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
  );
}

/**
 * Renovação condicional (RN-10): só grava se a sessão continua válida e o último uso é anterior a
 * `usoAnteriorA` (ou nulo). Requisições concorrentes geram no máximo uma escrita. true = gravou.
 */
export async function renovarSessao(d: {
  sessaoId: string;
  agora: Date;
  expiraEm: Date;
  usoAnteriorA: Date;
}): Promise<boolean> {
  const { count } = await obterPrisma().sessao.updateMany({
    where: {
      id: d.sessaoId,
      revogadaEm: null,
      expiraEm: { gt: d.agora },
      OR: [{ ultimoUsoEm: null }, { ultimoUsoEm: { lt: d.usoAnteriorA } }],
    },
    data: { ultimoUsoEm: d.agora, expiraEm: d.expiraEm },
  });
  return count === 1;
}

/** Revoga a sessão do token (logout). Idempotente: já revogada ou inexistente → 0. */
export async function revogarSessaoPorHash(tokenHash: string, agora: Date): Promise<number> {
  const { count } = await obterPrisma().sessao.updateMany({
    where: { tokenHash, revogadaEm: null },
    data: { revogadaEm: agora },
  });
  return count;
}

/** Revoga todas as sessões ainda não revogadas do usuário (E1.3, E2.2). Nunca apaga linhas. */
export async function revogarSessoesDoUsuario(usuarioId: string, agora: Date): Promise<number> {
  const { count } = await obterPrisma().sessao.updateMany({
    where: { usuarioId, revogadaEm: null },
    data: { revogadaEm: agora },
  });
  return count;
}
