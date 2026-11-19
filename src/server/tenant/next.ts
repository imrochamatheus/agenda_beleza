import { cookies } from 'next/headers';

import type { PapelDeSalao, TenantContext } from './context';
import { AcessoNegado } from './erros';
import { NOME_COOKIE_SESSAO, resolverTenant } from './sessao';
import type { Credencial } from './sessao';

// Único arquivo da camada tenant que importa next/headers (o núcleo de defineAcao não depende dele).

/** Lê o token do cookie de sessão da requisição atual; null sem cookie ou com valor vazio. */
export async function lerCredencialDoCookie(): Promise<Credencial> {
  const token = (await cookies()).get(NOME_COOKIE_SESSAO)?.value;
  return token ? { token } : null;
}

/**
 * Para Server Components: devolve o TenantContext da sessão do cookie. Lança NaoAutenticado sem
 * sessão válida e AcessoNegado se `papeis` for informado e não incluir o papel do usuário.
 */
export async function exigirContexto(papeis?: readonly PapelDeSalao[]): Promise<TenantContext> {
  const ctx = await resolverTenant(await lerCredencialDoCookie());
  if (papeis && !papeis.includes(ctx.papel)) {
    throw new AcessoNegado('papel não permitido');
  }
  return ctx;
}
