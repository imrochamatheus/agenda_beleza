import { createHash, createHmac } from 'node:crypto';

// Token do convite (D-032 §3.1): HMAC-SHA256 determinístico, base64url (43 caracteres). Só o SHA-256
// do token é gravado; o token em claro vive em memória até a chamada ao adaptador. O token nunca é
// comparado: a busca é por igualdade do hash (índice UNIQUE), valor derivado do que a cliente enviou.

const FORMATO = /^[A-Za-z0-9_-]{43}$/;

export function gerarToken(segredo: string, salaoId: string, reservaId: string): string {
  return createHmac('sha256', segredo).update(`convite-avaliacao:${salaoId}:${reservaId}`).digest('base64url');
}

export function hashDoToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Formato do token, verificado antes de qualquer consulta. */
export function tokenPlausivel(t: unknown): t is string {
  return typeof t === 'string' && FORMATO.test(t);
}
