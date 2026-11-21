import { ehAceite } from '@/server/consentimento/validacao';

import { LIMITE_COMENTARIO, MENSAGENS_AVALIACAO } from './tipos';
import type { ErrosAvaliacao } from './tipos';

// Validação pura do envio (D-032 §3.3, RN-7). Nunca lança.

const NOTA = /^[1-5]$/;

export function lerNota(v: unknown): number | null {
  if (typeof v === 'number') return Number.isInteger(v) && v >= 1 && v <= 5 ? v : null;
  if (typeof v === 'string' && NOTA.test(v)) return Number(v);
  return null;
}

/** Trim, colapso de espaços e remoção de NUL. Texto puro: o React escapa na exibição. */
export function normalizarComentario(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v.replaceAll('\u0000', '').replace(/\s+/g, ' ').trim();
}

export type EntradaCampos = { nota: unknown; comentario: unknown; aceite: unknown };
export type CamposValidos = { nota: number; comentario: string | null };

export function validarCampos(e: EntradaCampos): { ok: true; dados: CamposValidos } | { ok: false; erros: ErrosAvaliacao } {
  const erros: ErrosAvaliacao = {};
  const nota = lerNota(e.nota);
  if (nota === null) erros.nota = MENSAGENS_AVALIACAO.nota;
  const comentario = normalizarComentario(e.comentario);
  if (Array.from(comentario).length > LIMITE_COMENTARIO) erros.comentario = MENSAGENS_AVALIACAO.comentario;
  if (!ehAceite(e.aceite)) erros.aceite = MENSAGENS_AVALIACAO.aceite;
  if (nota === null || Object.keys(erros).length > 0) return { ok: false, erros };
  return { ok: true, dados: { nota, comentario: comentario === '' ? null : comentario } };
}
