import { Prisma } from '@/generated/prisma/client';

import { encerrarPrisma, obterPrisma } from './db';
import { criarRepos } from './index';
import type { Repos } from './index';

// Super admin (D-034). Repositório PRÉ-CONTEXTO da plataforma (exceção documentada à RN-8, como
// sessao.ts e rate-limit.ts): o admin não tem salão e o login acontece antes de existir contexto.
// Único arquivo que acessa as colunas de TOTP de `usuario`. Ordem de travas: usuario → sessao →
// auditoria (nunca salao). O segredo TOTP só circula cifrado (a cifra é do serviço).

export type AdminParaLogin = { id: string; senhaHash: string; totpAtivado: boolean };

/** Usuário super admin pelo e-mail normalizado; outro papel ou inexistente → null. */
export async function buscarAdminParaLogin(email: string): Promise<AdminParaLogin | null> {
  const u = await obterPrisma().usuario.findFirst({
    where: { email, papel: 'super_admin' },
    select: { id: true, senhaHash: true, totpAtivadoEm: true },
  });
  return u ? { id: u.id, senhaHash: u.senhaHash, totpAtivado: u.totpAtivadoEm !== null } : null;
}

export type EstadoTotp = {
  id: string;
  email: string;
  nome: string;
  segredoCifrado: string | null;
  ativadoEm: Date | null;
  ultimoPasso: number | null;
};

/** Estado do segundo fator do super admin. Outro papel ou inexistente → null. */
export async function lerEstadoTotp(usuarioId: string): Promise<EstadoTotp | null> {
  const u = await obterPrisma().usuario.findFirst({
    where: { id: usuarioId, papel: 'super_admin' },
    select: { id: true, email: true, nome: true, totpSegredoCifrado: true, totpAtivadoEm: true, totpUltimoPasso: true },
  });
  return u
    ? {
        id: u.id,
        email: u.email,
        nome: u.nome,
        segredoCifrado: u.totpSegredoCifrado,
        ativadoEm: u.totpAtivadoEm,
        // bigint do Prisma → number (passos TOTP cabem folgadamente em 2^53).
        ultimoPasso: u.totpUltimoPasso === null ? null : Number(u.totpUltimoPasso),
      }
    : null;
}

/** Nome e e-mail do admin para a tela mínima (RN-12). */
export async function lerIdentidadeDoAdmin(usuarioId: string): Promise<{ nome: string; email: string } | null> {
  const u = await obterPrisma().usuario.findFirst({
    where: { id: usuarioId, papel: 'super_admin' },
    select: { nome: true, email: true },
  });
  return u;
}

/**
 * Cria o super admin se o e-mail está livre: `INSERT … ON CONFLICT (email) DO NOTHING RETURNING id`
 * (nunca captura 23505). null = o e-mail já existe.
 */
export async function inserirSuperAdmin(d: {
  email: string;
  nome: string;
  senhaHash: string;
  agora: Date;
}): Promise<string | null> {
  const linhas = await obterPrisma().$queryRaw<{ id: string }[]>`
    INSERT INTO usuario (papel, salao_id, email, nome, senha_hash, email_confirmado_em)
    VALUES ('super_admin', NULL, ${d.email}::text, ${d.nome}::text, ${d.senhaHash}::text, ${d.agora}::timestamptz)
    ON CONFLICT (email) DO NOTHING
    RETURNING id::text AS id`;
  return linhas[0]?.id ?? null;
}

/** Papel da conta que já ocupa o e-mail (para recusar quando não é super admin). */
export async function papelDoEmail(email: string): Promise<'gestor' | 'profissional' | 'super_admin' | null> {
  const u = await obterPrisma().usuario.findUnique({ where: { email }, select: { papel: true } });
  return u?.papel ?? null;
}

/**
 * Grava o segredo pendente (cifrado) só se ainda não há segredo nem ativação. Sem linha afetada,
 * outro pedido já gravou: o chamador relê e usa o mesmo (S-1).
 */
export async function gravarSegredoPendente(usuarioId: string, segredoCifrado: string): Promise<boolean> {
  const n = await obterPrisma().$executeRaw`
    UPDATE usuario SET totp_segredo_cifrado = ${segredoCifrado}::text, atualizado_em = now()
     WHERE id = ${usuarioId}::uuid AND papel = 'super_admin'
       AND totp_ativado_em IS NULL AND totp_segredo_cifrado IS NULL`;
  return n === 1;
}

export type TokenHash = string;

/** Cria a pré-sessão (sem TOTP verificado). */
export async function criarPreSessao(d: {
  usuarioId: string;
  tokenHash: TokenHash;
  agora: Date;
  expiraEm: Date;
}): Promise<void> {
  await obterPrisma().sessao.create({
    data: { usuarioId: d.usuarioId, tokenHash: d.tokenHash, expiraEm: d.expiraEm, criadoEm: d.agora, ultimoUsoEm: d.agora },
    select: { id: true },
  });
}

/** Revoga a sessão do token (logout). Idempotente. */
export async function revogarSessaoAdminPorHash(tokenHash: TokenHash, agora: Date): Promise<number> {
  const { count } = await obterPrisma().sessao.updateMany({
    where: { tokenHash, revogadaEm: null, usuario: { papel: 'super_admin' } },
    data: { revogadaEm: agora },
  });
  return count;
}

/** Operações ligadas a UMA transação (lock `usuario` → `sessao`). */
export interface OperacoesAdmin {
  /**
   * Anti-replay (RN-4): avança `totp_ultimo_passo` só se ainda é menor. false = replay (0 linhas);
   * atômico sob concorrência (o concorrente espera o commit e reavalia o predicado).
   */
  avancarPasso(usuarioId: string, passo: number): Promise<boolean>;
  /**
   * Ativa o TOTP (RN-6): só se ainda não está ativado e o segredo gravado é o verificado; avança o
   * passo no mesmo UPDATE. false = outro cadastro venceu ou o segredo mudou.
   */
  ativarTotp(d: { usuarioId: string; segredoCifrado: string; passo: number; agora: Date }): Promise<boolean>;
  /** Revoga a pré-sessão do token (ainda sem TOTP, válida). false = já revogada/expirada. */
  revogarPreSessao(tokenHash: TokenHash, agora: Date): Promise<boolean>;
  /** Cria a sessão admin (TOTP verificado agora). */
  criarSessaoAdmin(d: { usuarioId: string; tokenHash: TokenHash; agora: Date; expiraEm: Date }): Promise<void>;
}

function operacoes(tx: Prisma.TransactionClient): OperacoesAdmin {
  return {
    async avancarPasso(usuarioId, passo) {
      const n = await tx.$executeRaw`
        UPDATE usuario SET totp_ultimo_passo = ${passo}::bigint
         WHERE id = ${usuarioId}::uuid AND papel = 'super_admin'
           AND (totp_ultimo_passo IS NULL OR totp_ultimo_passo < ${passo}::bigint)`;
      return n === 1;
    },
    async ativarTotp(d) {
      const n = await tx.$executeRaw`
        UPDATE usuario
           SET totp_ativado_em = ${d.agora}::timestamptz, totp_ultimo_passo = ${d.passo}::bigint, atualizado_em = now()
         WHERE id = ${d.usuarioId}::uuid AND papel = 'super_admin'
           AND totp_ativado_em IS NULL AND totp_segredo_cifrado = ${d.segredoCifrado}::text
           AND (totp_ultimo_passo IS NULL OR totp_ultimo_passo < ${d.passo}::bigint)`;
      return n === 1;
    },
    async revogarPreSessao(tokenHash, agora) {
      const { count } = await tx.sessao.updateMany({
        where: { tokenHash, revogadaEm: null, totpVerificadoEm: null, expiraEm: { gt: agora } },
        data: { revogadaEm: agora },
      });
      return count === 1;
    },
    async criarSessaoAdmin(d) {
      await tx.sessao.create({
        data: {
          usuarioId: d.usuarioId,
          tokenHash: d.tokenHash,
          expiraEm: d.expiraEm,
          criadoEm: d.agora,
          ultimoUsoEm: d.agora,
          totpVerificadoEm: d.agora,
        },
        select: { id: true },
      });
    },
  };
}

/** Uma transação READ COMMITTED com as operações do admin e os repositórios (auditoria). */
export function emTransacaoAdmin<T>(fn: (op: OperacoesAdmin, r: Repos) => Promise<T>): Promise<T> {
  return obterPrisma().$transaction((tx) => fn(operacoes(tx), criarRepos(tx)), {
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
  });
}

/** Fecha o pool do Prisma (scripts de linha de comando encerram o processo limpo). */
export const encerrarBanco = encerrarPrisma;
