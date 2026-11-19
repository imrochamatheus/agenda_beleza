import { randomBytes } from 'node:crypto';

import {
  criarSessao,
  revogarSessaoPorHash,
  revogarSessoesDoUsuario as revogarNoBanco,
} from '@/server/repos/sessao';
import { hashDoToken } from '@/server/tenant/sessao';

import { expiracaoInicial } from './validade';

// Ciclo de vida da sessão da equipe (D-010 §3.8; RN-9, RN-12, RN-13). Sem next/*: a casca (ações)
// grava e apaga o cookie. O banco guarda só hashDoToken(token).

/** Token novo de 32 bytes de gerador criptográfico, em base64url (43 caracteres). */
export function gerarToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Cria a sessão do usuário (login). O token é sempre gerado aqui: nunca se aceita token vindo do
 * cliente (sem fixação de sessão). Um usuário pode ter várias sessões.
 */
export async function iniciarSessao(usuarioId: string, agora: Date): Promise<{ token: string }> {
  const token = gerarToken();
  await criarSessao({ usuarioId, tokenHash: hashDoToken(token), agora, expiraEm: expiracaoInicial(agora) });
  return { token };
}

/** Logout: revoga a sessão do token. Idempotente; sem token, nada a fazer. Nunca lança por sessão inexistente. */
export async function encerrarSessao(token: string | null | undefined, agora: Date = new Date()): Promise<void> {
  if (typeof token !== 'string' || token.length === 0) {
    return;
  }
  await revogarSessaoPorHash(hashDoToken(token), agora);
}

/** Revoga todas as sessões do usuário (E1.3 ao redefinir senha, E2.2 ao desativar). Devolve quantas. */
export async function revogarSessoesDoUsuario(usuarioId: string, agora: Date = new Date()): Promise<number> {
  return revogarNoBanco(usuarioId, agora);
}
