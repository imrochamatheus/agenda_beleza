import { ehUuid } from '@/server/repos/ids';

import type { FiltrosMensagens } from './mensagens-tipos';
import { lerPaginaAdmin, unico } from './paginacao';
import type { Consulta } from './paginacao';
import { ESTADOS_MENSAGEM, TIPOS_MENSAGEM } from './rotulos-admin';

// Filtros da fila de mensagens (D-045 RN-13). Puro: valor inválido NUNCA vira erro, é ignorado e marca
// `ignorados`. Vazio ("Todas") não é inválido.

export function lerFiltrosMensagens(sp: Consulta): { filtros: FiltrosMensagens; ignorados: boolean } {
  let ignorados = false;
  const escolher = <T extends string>(v: string | undefined, lista: readonly T[]): T | null => {
    if (v === undefined || v === '') return null;
    if ((lista as readonly string[]).includes(v)) return v as T;
    ignorados = true;
    return null;
  };
  const estado = escolher(unico(sp.estado), ESTADOS_MENSAGEM);
  const tipo = escolher(unico(sp.tipo), TIPOS_MENSAGEM);
  const bruto = unico(sp.salao)?.trim();
  let salaoId: string | null = null;
  if (bruto !== undefined && bruto !== '') {
    if (ehUuid(bruto)) salaoId = bruto.toLowerCase();
    else ignorados = true;
  }
  // `unico` devolve undefined para lista (?estado=a&estado=b): conta como inválido.
  for (const k of ['estado', 'tipo', 'salao'] as const) {
    if (Array.isArray(sp[k])) ignorados = true;
  }
  return { filtros: { estado, tipo, salaoId, pagina: lerPaginaAdmin(unico(sp.pagina)) }, ignorados };
}

/** Query string da fila preservando os filtros (links de página, "Cancelar" e PRG). */
export function hrefDaFila(
  base: string,
  f: Pick<FiltrosMensagens, 'estado' | 'tipo' | 'salaoId'>,
  pagina: number,
  extra: Record<string, string> = {},
): string {
  const p = new URLSearchParams();
  if (f.estado !== null) p.set('estado', f.estado);
  if (f.salaoId !== null) p.set('salao', f.salaoId);
  if (f.tipo !== null) p.set('tipo', f.tipo);
  if (pagina > 1) p.set('pagina', String(pagina));
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  const q = p.toString();
  return q === '' ? base : `${base}${base.includes('?') ? '&' : '?'}${q}`;
}

export const haFiltroNaFila = (f: Pick<FiltrosMensagens, 'estado' | 'tipo' | 'salaoId'>): boolean =>
  f.estado !== null || f.tipo !== null || f.salaoId !== null;
