import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { ROTAS } from '@/config/navegacao';
import type { AdminContext } from '@/server/tenant/context';
import { ehErroDeDominio } from '@/server/tenant/erros';
import { lerCredencialDoCookie } from '@/server/tenant/next';
import { resolverAdmin, resolverTenant } from '@/server/tenant/sessao';

import { NOME_COOKIE_ADMIN } from './cookie-admin';
import { estadoDaSessaoAdmin } from './sessao-admin';

// Auxiliares de página e ação do super admin (D-034 RN-10). Único arquivo de auth/admin que importa
// next/*. `redirect` lança NEXT_REDIRECT: é sempre chamado FORA de try/catch.

export type AcessoAdmin = { tipo: 'permitido'; ctx: AdminContext } | { tipo: 'negado' };

/** Token do cookie `ab_admin` (pré-sessão ou sessão admin); null sem cookie ou vazio. */
export async function lerTokenAdminDoCookie(): Promise<string | null> {
  const token = (await cookies()).get(NOME_COOKIE_ADMIN)?.value;
  return token ? token : null;
}

/** Há sessão de salão (gestor/profissional) válida no `ab_sessao`? Só decide 403 em vez de 401. */
async function temSessaoDeSalao(): Promise<boolean> {
  const credencial = await lerCredencialDoCookie();
  if (credencial === null) {
    return false;
  }
  try {
    await resolverTenant(credencial);
    return true;
  } catch (e) {
    if (ehErroDeDominio(e)) {
      return false;
    }
    throw e;
  }
}

/**
 * Para páginas e ações sob /admin. Sem `ab_admin`: sessão de salão válida → `negado` (403, sem
 * redirecionar); nada → redirect para /admin/entrar (401). Pré-sessão (TOTP pendente) ou sessão
 * inválida → redirect para /admin/entrar, que decide a etapa; nunca renderiza conteúdo. Sessão admin
 * válida → `permitido` com o AdminContext (renova a validade, 30 min/8 h).
 */
export async function exigirAcessoAoAdmin(agora: Date = new Date()): Promise<AcessoAdmin> {
  const token = await lerTokenAdminDoCookie();
  let acesso: AcessoAdmin | null = null;
  if (token === null) {
    acesso = (await temSessaoDeSalao()) ? { tipo: 'negado' } : null;
  } else {
    const estado = await estadoDaSessaoAdmin(token, agora);
    if (estado.tipo === 'outro_papel') {
      acesso = { tipo: 'negado' };
    } else if (estado.tipo === 'admin') {
      try {
        acesso = { tipo: 'permitido', ctx: await resolverAdmin({ token }, agora) };
      } catch (e) {
        // Expirou entre a classificação e a resolução: volta a 401.
        if (!ehErroDeDominio(e)) {
          throw e;
        }
      }
    }
  }
  if (acesso === null) {
    redirect(ROTAS.adminEntrar);
  }
  return acesso;
}
