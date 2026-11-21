import { normalizarNome } from '@/lib/texto';
import { normalizarTelefoneBr } from '@/lib/telefone';

import { LIMITES_CLIENTE, MENSAGENS_CLIENTE } from './tipos';
import type { ErrosCliente } from './tipos';

// Validação pura da cliente (D-022 §3.1). Sem `server-only`: usável nos testes e nos componentes.

export function validarNomeCliente(v: unknown): { ok: true; valor: string } | { ok: false; erro: string } {
  const valor = normalizarNome(v, { min: LIMITES_CLIENTE.nomeMin, max: LIMITES_CLIENTE.nomeMax });
  if (valor !== null) return { ok: true, valor };
  const vazio = typeof v !== 'string' || v.trim() === '';
  return { ok: false, erro: vazio ? MENSAGENS_CLIENTE.nomeObrigatorio : MENSAGENS_CLIENTE.nomeTamanho };
}

export function validarTelefoneCliente(v: unknown): { ok: true; valor: string } | { ok: false; erro: string } {
  const valor = normalizarTelefoneBr(v);
  return valor === null ? { ok: false, erro: MENSAGENS_CLIENTE.telefone } : { ok: true, valor };
}

/** RN-1/RN-2: todos os erros juntos. */
export function validarEntradaCliente(e: {
  nome: unknown;
  telefone: unknown;
}): { ok: true; nome: string; telefoneE164: string } | { ok: false; erros: ErrosCliente } {
  const n = validarNomeCliente(e?.nome);
  const t = validarTelefoneCliente(e?.telefone);
  if (n.ok && t.ok) return { ok: true, nome: n.valor, telefoneE164: t.valor };
  const erros: ErrosCliente = {};
  if (!t.ok) erros.telefone = t.erro;
  if (!n.ok) erros.nome = n.erro;
  return { ok: false, erros };
}

/**
 * Chave de comparação da busca: NFD, sem U+0300..U+036F, minúsculas. A MESMA regra do SQL
 * (`lower(regexp_replace(normalize(nome, NFD), '[̀-ͯ]', '', 'g'))`), nos dois lados o mesmo
 * intervalo (nunca `\p{M}`).
 */
export function chaveDeBusca(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

const SO_TELEFONE = /^[0-9 ()\-+.]+$/;

/** RN-9: aparado, colapsado, cortado em 80 pontos de código; `digitos` só se a regra do telefone vale. */
export function lerBusca(v: unknown): { q: string; nome: string; digitos: string | null } {
  const bruto = typeof v === 'string' ? v : '';
  const limpo = bruto.replace(/\p{Cc}/gu, ' ').replace(/\s+/gu, ' ').trim();
  const q = Array.from(limpo).slice(0, LIMITES_CLIENTE.buscaMax).join('').trim();
  const digitos = SO_TELEFONE.test(q) ? q.replace(/\D/g, '') : '';
  return { q, nome: chaveDeBusca(q), digitos: digitos.length >= 3 ? digitos : null };
}

/** RN-8/A-9: só `^[1-9]\d{0,6}$`; qualquer outra coisa vira 1. */
export function lerPagina(v: unknown): number {
  return typeof v === 'string' && /^[1-9]\d{0,6}$/.test(v) ? Number(v) : 1;
}
