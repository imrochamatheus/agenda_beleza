import { ROTAS } from '@/config/navegacao';

// Destino após o login (D-010 RN-15, CA-8). Falha fechada: qualquer valor fora do painel vira
// /painel (sem redirecionamento aberto).

const BASE = 'http://destino.invalid';
const TAMANHO_MAXIMO = 2048;
const CONTROLE = /[\u0000-\u001F\u007F]/;

/** Sempre um caminho interno do painel; padrão ROTAS.painel. */
export function destinoAposLogin(proximo: unknown): string {
  if (typeof proximo !== 'string' || proximo.length === 0 || proximo.length > TAMANHO_MAXIMO) {
    return ROTAS.painel;
  }
  if (!proximo.startsWith('/') || proximo.startsWith('//') || proximo.includes('\\') || CONTROLE.test(proximo)) {
    return ROTAS.painel;
  }
  // Caminho relativo à raiz sobre uma base válida: o parser WHATWG não falha (só codifica) e
  // resolve `.`, `..` e `%2e%2e`.
  const url = new URL(proximo, BASE);
  if (url.origin !== BASE) {
    return ROTAS.painel;
  }
  if (url.pathname !== ROTAS.painel && !url.pathname.startsWith(`${ROTAS.painel}/`)) {
    return ROTAS.painel;
  }
  return url.pathname + url.search;
}
