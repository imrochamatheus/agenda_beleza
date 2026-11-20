import { redirect } from 'next/navigation';

import { ROTAS } from '@/config/navegacao';
import type { PapelDeSalao, TenantContext } from '@/server/tenant/context';
import { AcessoNegado, NaoAutenticado, ehErroDeDominio } from '@/server/tenant/erros';
import { exigirContexto, lerCredencialDoCookie } from '@/server/tenant/next';
import { resolverTenant } from '@/server/tenant/sessao';

import { destinoAposLogin } from './destino';
import { exigirPermissao } from './permissoes';
import type { Operacao } from './permissoes';

// Auxiliares de página do painel (D-010 §3.10; RN-15, RN-17, RN-21). Único arquivo de auth/ que
// importa next/navigation. `redirect` lança NEXT_REDIRECT: é sempre chamado FORA de try/catch (R-9).

export type AcessoPainel = { tipo: 'permitido'; ctx: TenantContext } | { tipo: 'negado' };

/**
 * Para páginas do painel: exigirContexto(papeis) + exigirPermissao(ctx, 'painel.acessar') e, se
 * informada, exigirPermissao(ctx, operacao) (D-013 §3.1). NaoAutenticado → redirect para
 * /entrar?proximo=<caminho>; AcessoNegado → { tipo: 'negado' } (a página mostra "Acesso negado",
 * D-9 opção b); outros erros são relançados.
 */
export async function exigirAcessoAoPainel(
  caminho: string,
  papeis?: readonly PapelDeSalao[],
  operacao?: Operacao,
): Promise<AcessoPainel> {
  let acesso: AcessoPainel | null;
  try {
    const ctx = await exigirContexto(papeis);
    exigirPermissao(ctx, 'painel.acessar');
    if (operacao !== undefined) {
      exigirPermissao(ctx, operacao);
    }
    acesso = { tipo: 'permitido', ctx };
  } catch (e) {
    if (e instanceof NaoAutenticado) {
      acesso = null;
    } else if (e instanceof AcessoNegado) {
      acesso = { tipo: 'negado' };
    } else {
      throw e;
    }
  }
  if (acesso === null) {
    redirect(`${ROTAS.entrar}?proximo=${encodeURIComponent(caminho)}`);
  }
  return acesso;
}

/**
 * Para /entrar: cookie com sessão de salão válida → destinoAposLogin(proximo); sem cookie, sessão
 * inválida ou de super admin → null (mostra o formulário). Sem cookie, não consulta o banco.
 */
export async function destinoSeJaAutenticado(proximo: unknown): Promise<string | null> {
  const credencial = await lerCredencialDoCookie();
  if (credencial === null) {
    return null;
  }
  try {
    await resolverTenant(credencial);
  } catch (e) {
    if (ehErroDeDominio(e)) {
      return null;
    }
    throw e;
  }
  return destinoAposLogin(proximo);
}
