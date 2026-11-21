import { criarPreSessao, revogarSessaoAdminPorHash } from '@/server/repos/admin';
import { buscarSessaoValida } from '@/server/repos/sessao';
import { hashDoToken } from '@/server/tenant/sessao';

import { gerarToken } from '../sessao';

import { expiracaoPreauth } from './validade-admin';

// Ciclo de vida da sessão do super admin (D-034 RN-7, RN-8). Sem next/*: a casca grava e apaga o
// cookie `ab_admin`. O banco guarda só o SHA-256 do token. A promoção (pré-sessão → sessão admin)
// acontece em login-admin.ts, na MESMA transação do `login.sucesso`.

/** Pré-sessão (senha certa, TOTP pendente): 10 min, sem renovação. Token novo, nunca vindo do cliente. */
export async function iniciarPreSessao(usuarioId: string, agora: Date): Promise<{ token: string }> {
  const token = gerarToken();
  await criarPreSessao({ usuarioId, tokenHash: hashDoToken(token), agora, expiraEm: expiracaoPreauth(agora) });
  return { token };
}

/** Logout: revoga a sessão (pré ou admin) do token. Idempotente; sem token não faz nada. */
export async function encerrarSessaoAdmin(token: string | null | undefined, agora: Date = new Date()): Promise<void> {
  if (typeof token !== 'string' || token.length === 0) {
    return;
  }
  await revogarSessaoAdminPorHash(hashDoToken(token), agora);
}

export type EstadoDaSessaoAdmin =
  | { tipo: 'nenhuma' }
  /** Token de uma sessão de outro papel (nunca vale no admin). */
  | { tipo: 'outro_papel' }
  | { tipo: 'preauth'; usuarioId: string }
  | { tipo: 'admin'; usuarioId: string };

/** Classifica o token do cookie `ab_admin`. Só leitura: não renova nada. */
export async function estadoDaSessaoAdmin(token: string | null | undefined, agora: Date): Promise<EstadoDaSessaoAdmin> {
  if (typeof token !== 'string' || token.length === 0) {
    return { tipo: 'nenhuma' };
  }
  const sessao = await buscarSessaoValida(hashDoToken(token), agora);
  if (sessao === null) {
    return { tipo: 'nenhuma' };
  }
  if (sessao.papel !== 'super_admin') {
    return { tipo: 'outro_papel' };
  }
  return sessao.totpVerificadoEm === null
    ? { tipo: 'preauth', usuarioId: sessao.usuarioId }
    : { tipo: 'admin', usuarioId: sessao.usuarioId };
}
