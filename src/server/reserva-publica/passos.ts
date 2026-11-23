// Derivação PURA do passo do fluxo público a partir da query string (D-026 §3, RN-15; D-050 §3.10). Cada
// parâmetro é validado de forma defensiva: um parâmetro inválido volta ao passo válido mais avançado, nunca
// vira erro 500. O estado inteiro fica na query (GET, sem JavaScript e sem dado pessoal):
//   s       serviços, repetido, na ordem de escolha (1..10, UUID, sem repetição)
//   data    AAAA-MM-DD, dentro de [hoje, hoje + janela]
//   de      início da página de dias (passo "data")
//   h0..h9  item do serviço s[k]: `<profissionalId>_<isoUTC>`
//   f       filtro de profissional do passo atual
//   alterar `servicos` ou o índice do item a alterar
//   enviado índice do passo cujo formulário foi enviado (aviso "Escolha um horário para X")
//   aviso   código fechado (`CODIGOS_AVISO`)
import { SEGMENTOS_RESERVADOS } from '@/config/navegacao';
import { compararDatas, ehDataCivilValida, somarDias } from '@/server/tempo/fuso';
import type { DataCivil } from '@/server/tempo/fuso';

import { CODIGOS_AVISO } from './tipos';
import type { CodigoAviso, ConsultaDaUrl } from './tipos';

export type ParametrosBrutos = Record<string, string | string[] | undefined>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/;
export const DIAS_POR_PAGINA = 14;
export const LIMITE_ITENS = 10;
/** Separador entre o profissional e o instante no valor do item (`h<k>` e rádio do `SlotGrid`). */
export const SEPARADOR_ITEM = '_';

/** Pré-checagem do segmento antes de qualquer consulta ao banco (RN-1, RN-2). */
export function slugPlausivel(slug: unknown): slug is string {
  return typeof slug === 'string' && slug.length <= 50 && SLUG.test(slug) && !SEGMENTOS_RESERVADOS.has(slug);
}

const lista = (v: string | string[] | undefined): string[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const primeiro = (v: string | string[] | undefined): string | undefined => lista(v)[0];
/** Valor único: repetido ou ausente → undefined. */
const unico = (v: string | string[] | undefined): string | undefined => {
  const l = lista(v);
  return l.length === 1 ? l[0] : undefined;
};

/** 1–10 UUIDs sem repetição, na ordem recebida (minúsculos); senão null. */
export function lerServicoIds(v: string | string[] | undefined): string[] | null {
  const ids = lista(v).map((x) => x.toLowerCase());
  if (ids.length < 1 || ids.length > LIMITE_ITENS) return null;
  if (!ids.every((x) => UUID.test(x)) || new Set(ids).size !== ids.length) return null;
  return ids;
}

/** Um UUID (minúsculo); senão null. */
export function lerUuid(v: string | string[] | undefined): string | null {
  const x = unico(v)?.toLowerCase();
  return x !== undefined && UUID.test(x) ? x : null;
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
  if (x === undefined || !ISO.test(x)) return null;
  const d = new Date(x);
  return Number.isNaN(d.getTime()) || d.toISOString() !== x ? null : d;
}

export function lerAviso(v: string | string[] | undefined): CodigoAviso | null {
  const x = primeiro(v);
  return (CODIGOS_AVISO as readonly string[]).includes(x ?? '') ? (x as CodigoAviso) : null;
}

/** Item da URL: profissional e início (instante UTC). */
export type ItemDaUrl = { profissionalId: string; inicio: Date };

/** Valor do item na URL e no rádio: `<profissionalId>_<isoUTC>`. */
export function valorDoItem(profissionalId: string, inicio: Date | string): string {
  return `${profissionalId.toLowerCase()}${SEPARADOR_ITEM}${typeof inicio === 'string' ? inicio : inicio.toISOString()}`;
}

/** `<uuid>_<iso canônico>` em valor único; repetido, ausente ou malformado → null. */
export function lerItem(v: string | string[] | undefined): ItemDaUrl | null {
  const x = unico(v);
  if (x === undefined) return null;
  const i = x.indexOf(SEPARADOR_ITEM);
  if (i < 0) return null;
  const profissionalId = x.slice(0, i).toLowerCase();
  const inicio = lerHorario(x.slice(i + 1));
  return UUID.test(profissionalId) && inicio !== null ? { profissionalId, inicio } : null;
}

/** Índice inteiro em [0, n) escrito sem zeros à esquerda; senão null. */
function lerIndice(v: string | string[] | undefined, n: number): number | null {
  const x = unico(v);
  if (x === undefined || !/^(0|[1-9]\d?)$/.test(x)) return null;
  const k = Number(x);
  return k < n ? k : null;
}

function lerAlterar(v: string | string[] | undefined, n: number): 'servicos' | number | null {
  return unico(v) === 'servicos' ? 'servicos' : lerIndice(v, n);
}

/** Itens h0..h(n-1), por índice de `s` (null = ausente ou inválido). */
export function lerItens(params: ParametrosBrutos, n: number): (ItemDaUrl | null)[] {
  return Array.from({ length: n }, (_, k) => lerItem(params[`h${k}`]));
}

export const chaveDeData = (d: DataCivil): string =>
  `${String(d.ano).padStart(4, '0')}-${String(d.mes).padStart(2, '0')}-${String(d.dia).padStart(2, '0')}`;

type Aviso = { aviso: CodigoAviso | null };
export type PassoLido =
  | ({ passo: 'servicos'; marcados: string[] } & Aviso)
  | ({ passo: 'data'; s: string[]; de: DataCivil } & Aviso)
  | ({
      passo: 'servico';
      s: string[];
      data: DataCivil;
      /** Serviço em escolha (índice em `s`). */
      indice: number;
      /** Itens de TODOS os serviços (o do índice incluído quando veio de "Alterar"). */
      itens: (ItemDaUrl | null)[];
      /** Item atual do serviço quando veio de "Alterar" (pré-seleção); senão null. */
      preSelecionado: ItemDaUrl | null;
      alterando: boolean;
      filtro: string | null;
    } & Aviso)
  | { passo: 'dados'; s: string[]; data: DataCivil; itens: ItemDaUrl[] };

/**
 * Passo mais avançado cujos parâmetros estão todos válidos. A data precisa estar em [hoje, hoje + janela]
 * (dias civis do salão); `de` (início da lista de dias) é ajustado ao intervalo. O primeiro `h<k>` ausente ou
 * inválido define o passo do serviço k; `alterar=k` força o passo k com o item atual pré-selecionado.
 * A data de cada item NÃO é conferida aqui (a função não conhece o fuso): `carregarPasso` só oferece
 * horários da `data`, então um item de outro dia volta ao seu passo.
 */
export function lerPasso(params: ParametrosBrutos, ctx: { hoje: DataCivil; janelaDias: number }): PassoLido {
  const aviso = lerAviso(params.aviso);
  const s = lerServicoIds(params.s);
  if (s === null) return { passo: 'servicos', marcados: [], aviso };
  const alterar = lerAlterar(params.alterar, s.length);
  if (alterar === 'servicos') return { passo: 'servicos', marcados: s, aviso };

  const ultima = somarDias(ctx.hoje, ctx.janelaDias);
  const data = lerData(params.data);
  if (data === null || compararDatas(data, ctx.hoje) < 0 || compararDatas(data, ultima) > 0) {
    const bruto = lerData(params.de);
    let de = bruto ?? ctx.hoje;
    if (compararDatas(de, ctx.hoje) < 0) de = ctx.hoje;
    if (compararDatas(de, ultima) > 0) de = ultima;
    return { passo: 'data', s, de, aviso };
  }

  const itens = lerItens(params, s.length);
  const indice = typeof alterar === 'number' ? alterar : itens.findIndex((x) => x === null);
  if (indice < 0) return { passo: 'dados', s, data, itens: itens as ItemDaUrl[] };

  const alterando = alterar === indice;
  const enviado = lerIndice(params.enviado, s.length);
  return {
    passo: 'servico',
    s,
    data,
    indice,
    itens,
    preSelecionado: alterando ? itens[indice] : null,
    alterando,
    filtro: lerUuid(params.f),
    aviso: aviso ?? (enviado === indice && itens[indice] === null ? 'sem_selecao' : null),
  };
}

/**
 * Seleção completa enviada no formulário de dados (POST): `s`, `data` e TODOS os `h<k>` válidos. Usada pela
 * casca para montar `EntradaReservaPublica` e a reescolha; null se algo falta (a casca volta aos serviços).
 */
export function lerSelecao(params: ParametrosBrutos): { s: string[]; data: string; itens: ItemDaUrl[] } | null {
  const s = lerServicoIds(params.s);
  const data = lerData(params.data);
  if (s === null || data === null) return null;
  const itens = lerItens(params, s.length);
  return itens.every((x) => x !== null) ? { s, data: chaveDeData(data), itens: itens as ItemDaUrl[] } : null;
}

/** Valores `h` da consulta a partir dos itens (null = sem item). */
export const valoresDosItens = (itens: readonly (ItemDaUrl | null)[]): (string | null)[] =>
  itens.map((x) => (x === null ? null : valorDoItem(x.profissionalId, x.inicio)));

/**
 * Monta `base?s=..&s=..&data=..&de=..&h0=..&f=..&alterar=..&enviado=..&aviso=..` (valores codificados;
 * só chaves conhecidas; `h<k>` na ordem dos índices, omitindo os nulos).
 */
export function montarHref(base: string, q: ConsultaDaUrl): string {
  const u = new URLSearchParams();
  for (const id of q.s ?? []) u.append('s', id);
  if (q.data !== undefined) u.append('data', q.data);
  if (q.de !== undefined) u.append('de', q.de);
  (q.h ?? []).forEach((v, k) => {
    if (v !== null && v !== undefined) u.append(`h${k}`, v);
  });
  if (q.f !== undefined) u.append('f', q.f);
  if (q.alterar !== undefined) u.append('alterar', String(q.alterar));
  if (q.enviado !== undefined) u.append('enviado', String(q.enviado));
  if (q.aviso !== undefined) u.append('aviso', q.aviso);
  const texto = u.toString();
  return texto === '' ? base : `${base}?${texto}`;
}

/**
 * Campos ocultos do formulário GET do passo do serviço `indice` (ou do POST de dados, sem `indice`): os
 * serviços, a data e os itens dos OUTROS serviços. O item do próprio passo vem do rádio (`name = h<indice>`).
 */
export function camposOcultos(q: ConsultaDaUrl, indice?: number): { name: string; value: string }[] {
  const campos = (q.s ?? []).map((id) => ({ name: 's', value: id }));
  if (q.data !== undefined) campos.push({ name: 'data', value: q.data });
  (q.h ?? []).forEach((v, k) => {
    if (v !== null && v !== undefined && k !== indice) campos.push({ name: `h${k}`, value: v });
  });
  if (indice !== undefined) campos.push({ name: 'enviado', value: String(indice) });
  return campos;
}

/** "Alterar" de um item: volta ao passo dele com os demais preservados (CA-9). */
export const hrefAlterarItem = (base: string, q: ConsultaDaUrl, indice: number): string =>
  montarHref(base, { s: q.s, data: q.data, h: q.h, alterar: indice });

/** Filtro de profissional do passo `indice` (null = "Todos"); preserva o "Alterar" em curso. */
export const hrefFiltro = (base: string, q: ConsultaDaUrl, filtro: string | null, alterando: number | null = null): string =>
  montarHref(base, {
    s: q.s,
    data: q.data,
    h: q.h,
    ...(filtro !== null && { f: filtro }),
    ...(alterando !== null && { alterar: alterando }),
  });

/** "Escolher outro dia": lista de dias a partir da data atual; os horários escolhidos caem (eram do dia). */
export const hrefOutroDia = (base: string, q: ConsultaDaUrl): string =>
  montarHref(base, { s: q.s, ...(q.data !== undefined && { de: q.data }) });

/** "Alterar serviços": primeiro passo com os serviços marcados. */
export const hrefAlterarServicos = (base: string, q: ConsultaDaUrl): string =>
  montarHref(base, { s: q.s, alterar: 'servicos' });

/** "Seguir sem {serviço}": tira o serviço `indice` e o item dele, mantendo os demais (sem PII). */
export function hrefSeguirSem(base: string, q: ConsultaDaUrl, indice: number): string {
  const s = (q.s ?? []).filter((_, k) => k !== indice);
  if (s.length === 0) return base;
  const h = (q.h ?? []).filter((_, k) => k !== indice);
  return montarHref(base, { s, data: q.data, h });
}
