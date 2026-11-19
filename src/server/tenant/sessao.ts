import { createHash } from 'node:crypto';

import { buscarSessaoValida } from '@/server/repos/sessao';

import { criarAdminContext, criarTenantContext, ehPapelDeSalao } from './context';
import type { AdminContext, TenantContext } from './context';
import { AcessoNegado, NaoAutenticado } from './erros';

/** Nome do cookie de sessão da equipe (S-2). Atributos do cookie e login são da E1.2. */
export const NOME_COOKIE_SESSAO = 'ab_sessao';

/** Hash do token opaco do cookie: SHA-256 em hexadecimal. O token em claro nunca é gravado. */
export function hashDoToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Token em claro vindo do cookie, ou null sem cookie. */
export type Credencial = { token: string } | null;

async function sessaoDaCredencial(c: Credencial, agora: Date) {
  const token = c?.token;
  // Sem credencial ou token vazio: 401 sem consultar o banco.
  if (typeof token !== 'string' || token.length === 0) {
    throw new NaoAutenticado();
  }
  const sessao = await buscarSessaoValida(hashDoToken(token), agora);
  if (!sessao) {
    throw new NaoAutenticado();
  }
  return sessao;
}

/**
 * Credencial → TenantContext. NaoAutenticado sem sessão válida; AcessoNegado para super admin
 * (não tem salão, RN-11). O salaoId vem só da sessão (RN-1).
 */
export async function resolverTenant(c: Credencial, agora: Date = new Date()): Promise<TenantContext> {
  const sessao = await sessaoDaCredencial(c, agora);
  if (!ehPapelDeSalao(sessao.papel) || sessao.salaoId === null) {
    throw new AcessoNegado('papel sem salão');
  }
  return criarTenantContext({
    usuarioId: sessao.usuarioId,
    papel: sessao.papel,
    salaoId: sessao.salaoId,
    profissionalId: sessao.profissionalId,
  });
}

/**
 * Credencial → AdminContext. Exige papel super_admin E segundo fator concluído nesta sessão
 * (`totp_verificado_em`, RN-11). Usuário de salão ou super admin sem TOTP → AcessoNegado.
 */
export async function resolverAdmin(c: Credencial, agora: Date = new Date()): Promise<AdminContext> {
  const sessao = await sessaoDaCredencial(c, agora);
  if (sessao.papel !== 'super_admin') {
    throw new AcessoNegado('papel não é super_admin');
  }
  if (sessao.totpVerificadoEm === null) {
    throw new AcessoNegado('TOTP não verificado');
  }
  return criarAdminContext(sessao.usuarioId);
}
