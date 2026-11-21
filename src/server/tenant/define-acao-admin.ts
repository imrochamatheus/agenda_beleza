import { lerTokenAdminDoCookie } from '@/server/auth/admin/pagina';

import type { AdminContext } from './context';
import { METADADOS_ACAO } from './define-acao';
import { AcessoNegado, NaoAutenticado, ehErroDeDominio } from './erros';
import type { CodigoErro, StatusErro } from './erros';
import { lerCredencialDoCookie } from './next';
import { resolverAdmin, resolverTenant } from './sessao';
import type { Credencial } from './sessao';

// Ação de servidor do SUPER ADMIN (D-035 R-1). `defineAcao` é só de salão (papéis de salão, capacidade,
// cookie `ab_sessao`); esta lê o cookie `ab_admin` e exige sessão com TOTP verificado (`resolverAdmin`).
// Sem sessão admin: se há sessão de salão VÁLIDA (gestor/profissional) → 403 real; senão → 401. Sessão
// admin de pré-autenticação (sem TOTP) ou de outro papel → 403 (`resolverAdmin`); inválida/expirada → 401.
// O núcleo `executar` recebe as credenciais já lidas e não depende de next/headers (testável).

export type ResultadoAcaoAdmin<O> =
  | { ok: true; dados: O }
  | { ok: false; erro: CodigoErro; status: StatusErro };

export type ExecucaoAdmin = { readonly agora: Date };

/** Credenciais das duas áreas, lidas dos cookies `ab_admin` e `ab_sessao`. */
export type CredenciaisAdmin = { admin: Credencial; salao: Credencial };

export type DepsAcaoAdmin = { agora?: Date };

export interface AcaoAdmin<I, O> {
  /** Forma chamável usada pelo Next: lê os cookies e chama `executar`. */
  (input: I): Promise<ResultadoAcaoAdmin<O>>;
  /** Núcleo, sem next/headers. */
  executar(c: CredenciaisAdmin, input: I, deps?: DepsAcaoAdmin): Promise<ResultadoAcaoAdmin<O>>;
  /** Metadados de registro: sempre só o papel `admin` (sem capacidade de salão). */
  readonly [METADADOS_ACAO]: Readonly<{ tipo: 'admin'; papeis: readonly ['admin'] }>;
}

/** Há sessão de salão válida? Só serve para escolher 403 em vez de 401; nunca autoriza nada. */
async function temSessaoDeSalao(c: Credencial, agora: Date): Promise<boolean> {
  if (c === null) return false;
  try {
    await resolverTenant(c, agora);
    return true;
  } catch (e) {
    if (ehErroDeDominio(e)) return false;
    throw e;
  }
}

export function defineAcaoAdmin<I, O>(
  handler: (ctx: AdminContext, input: I, exec: ExecucaoAdmin) => Promise<O>,
): AcaoAdmin<I, O> {
  const metadados = Object.freeze({ tipo: 'admin' as const, papeis: Object.freeze(['admin'] as const) });

  async function executar(c: CredenciaisAdmin, input: I, deps: DepsAcaoAdmin = {}): Promise<ResultadoAcaoAdmin<O>> {
    const agora = deps.agora ?? new Date();
    try {
      if (c.admin === null) {
        throw (await temSessaoDeSalao(c.salao, agora)) ? new AcessoNegado('sem sessão de admin') : new NaoAutenticado();
      }
      const ctx = await resolverAdmin(c.admin, agora);
      return { ok: true, dados: await handler(ctx, input, Object.freeze({ agora })) };
    } catch (e) {
      if (ehErroDeDominio(e)) return { ok: false, erro: e.codigo, status: e.status };
      throw e;
    }
  }

  const acao = async (input: I): Promise<ResultadoAcaoAdmin<O>> => {
    const token = await lerTokenAdminDoCookie();
    return executar({ admin: token === null ? null : { token }, salao: await lerCredencialDoCookie() }, input);
  };
  Object.defineProperty(acao, 'executar', { value: executar, enumerable: false });
  Object.defineProperty(acao, METADADOS_ACAO, { value: metadados, enumerable: false });
  return acao as AcaoAdmin<I, O>;
}
