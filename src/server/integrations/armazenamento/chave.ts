// Chave dos objetos (D-021 §3.1; RN-8): gerada pelo servidor, ≥ 128 bits, sem dado do usuário.
import { randomBytes } from 'node:crypto';

export const CHAVE_REGEX = /^fotos\/[A-Za-z0-9_-]{22,}\.webp$/u;

export function ehChaveValida(chave: unknown): chave is string {
  return typeof chave === 'string' && CHAVE_REGEX.test(chave);
}

export function gerarChave(): string {
  return `fotos/${randomBytes(16).toString('base64url')}.webp`;
}
