// Derivação PURA do passo do fluxo público a partir da query string (D-026 §3, RN-15). Cada parâmetro é
// validado de forma defensiva: um parâmetro inválido volta ao passo anterior, nunca vira erro 500.
import { SEGMENTOS_RESERVADOS } from '@/config/navegacao';
import { compararDatas, ehDataCivilValida, somarDias } from '@/server/tempo/fuso';
import type { DataCivil } from '@/server/tempo/fuso';

import { CODIGOS_AVISO } from './tipos';
import type { CodigoAviso } from './tipos';

export type ParametrosBrutos = Record<string, string | string[] | undefined>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const DIAS_POR_PAGINA = 14;
export const QUALQUER = 'qualquer';

/** Pré-checagem do segmento antes de qualquer consulta ao banco (RN-1, RN-2). */
export function slugPlausivel(slug: unknown): slug is string {
  return typeof slug === 'string' && slug.length <= 50 && SLUG.test(slug) && !SEGMENTOS_RESERVADOS.has(slug);
}

const lista = (v: string | string[] | undefined): string[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const primeiro = (v: string | string[] | undefined): string | undefined => lista(v)[0];

/** 1–10 UUIDs sem repetição, na ordem recebida (minúsculos); senão null. */
export function lerServicoIds(v: string | string[] | undefined): string[] | null {
  const ids = lista(v).map((x) => x.toLowerCase());
  if (ids.length < 1 || ids.length > 10) return null;
  if (!ids.every((x) => UUID.test(x)) || new Set(ids).size !== ids.length) return null;
  return ids;
}

/** `qualquer` ou um UUID (minúsculo); senão null. */
export function lerProfissional(v: string | string[] | undefined): string | null {
  const x = primeiro(v)?.toLowerCase();
  if (x === undefined) return null;
  return x === QUALQUER || UUID.test(x) ? x : null;
}

/** 'AAAA-MM-DD' de uma data real; senão null. */
export function lerData(v: string | string[] | undefined): DataCivil | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(primeiro(v) ?? '');
  if (m === null) return null;
  const d = { ano: Number(m[1]), mes: Number(m[2]), dia: Number(m[3]) };
  return ehDataCivilValida(d) ? d : null;
}

/** Instante UTC canônico (`toISOString`, segundos zero); senão null. */
export function lerHorario(v: string | string[] | undefined): Date | null {
  const x = primeiro(v);
  if (x === undefined || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/.test(x)) return null;
  const d = new Date(x);
  return Number.isNaN(d.getTime()) || d.toISOString() !== x ? null : d;
}

export function lerAviso(v: string | string[] | undefined): CodigoAviso | null {
  const x = primeiro(v);
  return (CODIGOS_AVISO as readonly string[]).includes(x ?? '') ? (x as CodigoAviso) : null;
}

export const chaveDeData = (d: DataCivil): string =>
  `${String(d.ano).padStart(4, '0')}-${String(d.mes).padStart(2, '0')}-${String(d.dia).padStart(2, '0')}`;

type Aviso = { aviso: CodigoAviso | null };
export type PassoLido =
  | ({ passo: 'servicos' } & Aviso)
  | ({ passo: 'profissional'; s: string[] } & Aviso)
  | ({ passo: 'data'; s: string[]; p: string; de: DataCivil } & Aviso)
  | ({ passo: 'horario'; s: string[]; p: string; data: DataCivil } & Aviso)
  | ({ passo: 'dados'; s: string[]; p: string; data: DataCivil; h: Date } & Aviso);

/**
 * Passo mais avançado cujos parâmetros estão todos válidos. A data precisa estar em [hoje, hoje + janela]
 * (dias civis do salão); `de` (início da lista de dias) é ajustado ao intervalo.
 */
export function lerPasso(params: ParametrosBrutos, ctx: { hoje: DataCivil; janelaDias: number }): PassoLido {
  const aviso = lerAviso(params.aviso);
  const s = lerServicoIds(params.s);
  if (s === null) return { passo: 'servicos', aviso };
  const p = lerProfissional(params.p);
  if (p === null) return { passo: 'profissional', s, aviso };

  const ultima = somarDias(ctx.hoje, ctx.janelaDias);
  const data = lerData(params.data);
  if (data === null || compararDatas(data, ctx.hoje) < 0 || compararDatas(data, ultima) > 0) {
    const bruto = lerData(params.de);
    let de = bruto ?? ctx.hoje;
    if (compararDatas(de, ctx.hoje) < 0) de = ctx.hoje;
    if (compararDatas(de, ultima) > 0) de = ultima;
    return { passo: 'data', s, p, de, aviso };
  }
  const h = lerHorario(params.h);
  if (h === null) return { passo: 'horario', s, p, data, aviso };
  return { passo: 'dados', s, p, data, h, aviso };
}

export type ConsultaDaUrl = {
  s?: readonly string[];
  p?: string;
  data?: string;
  h?: string;
  de?: string;
  aviso?: CodigoAviso;
};

/** Monta `base?s=..&s=..&p=..&data=..&h=..` (valores codificados; só chaves conhecidas). */
export function montarHref(base: string, q: ConsultaDaUrl): string {
  const u = new URLSearchParams();
  for (const id of q.s ?? []) u.append('s', id);
  for (const k of ['p', 'data', 'h', 'de', 'aviso'] as const) {
    const v = q[k];
    if (v !== undefined) u.append(k, v);
  }
  const texto = u.toString();
  return texto === '' ? base : `${base}?${texto}`;
}
