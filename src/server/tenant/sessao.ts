import { createHash } from 'node:crypto';

import {
  INTERVALO_RENOVACAO_ADMIN_MS,
  expiracaoAdmin,
  precisaRenovarAdmin,
} from '@/server/auth/admin/validade-admin';
import { INTERVALO_RENOVACAO_MS, novaExpiracao, precisaRenovar } from '@/server/auth/validade';
import { buscarSessaoValida, renovarSessao } from '@/server/repos/sessao';

import { criarAdminContext, criarTenantContext, ehPapelDeSalao } from './context';
import type { AdminContext, TenantContext } from './context';
import { AcessoNegado, NaoAutenticado } from './erros';

/** Nome do cookie de sessão da equipe (S-2). Mora em auth/cookie.ts (DD-1); reexportado aqui. */
export { NOME_COOKIE_SESSAO } from '@/server/auth/cookie';

/** Hash do token opaco do cookie: SHA-256 em hexadecimal. O token em claro nunca é gravado. */
export function hashDoToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Token em claro vindo do cookie, ou null sem cookie. */
export type Credencial = { token: string } | null;

async function sessaoDaCredencial(c: Credencial, agora: Date, modo: 'tenant' | 'admin') {
  const token = c?.token;
  // Sem credencial ou token vazio: 401 sem consultar o banco.
  if (typeof token !== 'string' || token.length === 0) {
    throw new NaoAutenticado();
  }
  const sessao = await buscarSessaoValida(hashDoToken(token), agora);
  if (!sessao) {
    throw new NaoAutenticado();
  }
  // D-034 RN-8: sessão de super admin NUNCA usa a renovação de 7/30 dias do salão. Só `resolverAdmin`
  // a renova, e só com TOTP verificado: min(uso + 30 min, criação + 8 h), no máximo uma escrita por
  // minuto. A pré-sessão (sem TOTP) e `resolverTenant` não renovam nada.
  if (sessao.papel === 'super_admin') {
    if (modo === 'admin' && sessao.totpVerificadoEm !== null && precisaRenovarAdmin(sessao.ultimoUsoEm, agora)) {
      await renovarSessao({
        sessaoId: sessao.sessaoId,
        agora,
        expiraEm: expiracaoAdmin(sessao.criadoEm, agora),
        usoAnteriorA: new Date(agora.getTime() - INTERVALO_RENOVACAO_ADMIN_MS),
      });
    }
    return sessao;
  }
  // Renovação no uso (D-010 RN-10): no máximo uma escrita por hora, por UPDATE condicional. O
  // resultado é ignorado: se outra requisição já renovou, a sessão continua válida do mesmo jeito.
  if (precisaRenovar(sessao.ultimoUsoEm, agora)) {
    await renovarSessao({
      sessaoId: sessao.sessaoId,
      agora,
      expiraEm: novaExpiracao(sessao.criadoEm, agora),
      usoAnteriorA: new Date(agora.getTime() - INTERVALO_RENOVACAO_MS),
    });
  }
  return sessao;
}

/**
 * Credencial → TenantContext. NaoAutenticado sem sessão válida; AcessoNegado para super admin
 * (não tem salão, RN-11). O salaoId vem só da sessão (RN-1). Profissional com perfil inativo ou sem
 * perfil → NaoAutenticado (D-010 RN-14, defesa em profundidade, mesmo sem revogação); o gestor
 * com perfil inativo continua entrando como gestor.
 */
export async function resolverTenant(c: Credencial, agora: Date = new Date()): Promise<TenantContext> {
  const sessao = await sessaoDaCredencial(c, agora, 'tenant');
  if (!ehPapelDeSalao(sessao.papel) || sessao.salaoId === null) {
    throw new AcessoNegado('papel sem salão');
  }
  if (sessao.papel === 'profissional' && sessao.profissionalAtivo !== true) {
    throw new NaoAutenticado();
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
  const sessao = await sessaoDaCredencial(c, agora, 'admin');
  if (sessao.papel !== 'super_admin') {
    throw new AcessoNegado('papel não é super_admin');
  }
  if (sessao.totpVerificadoEm === null) {
    throw new AcessoNegado('TOTP não verificado');
  }
  return criarAdminContext(sessao.usuarioId);
}
