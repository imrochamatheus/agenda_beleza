// Extração do IP do cliente (D-027 RN-5). Sem next/*. Com `hops` 0 nenhum cabeçalho é confiável: só o IP
// da conexão, quando o chamador o tiver (o App Router não o expõe; sem ele, balde único "desconhecido").
// Com N > 0, vale a N-ésima entrada de `x-forwarded-for` contada da direita (as N entradas finais foram
// anexadas por proxies confiáveis; as anteriores podem ser forjadas).
import { isIP } from 'node:net';

import { IP_DESCONHECIDO } from './tipos';

function normalizar(bruto: string | null | undefined): string | null {
  if (bruto === null || bruto === undefined) return null;
  let v = bruto.trim().toLowerCase();
  if (v === '' || v.length > 64) return null;
  if (v.startsWith('[') && v.endsWith(']')) v = v.slice(1, -1);
  const mapeado = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(v);
  if (mapeado) v = mapeado[1];
  return isIP(v) === 0 ? null : v;
}

export function extrairIp(h: { get(nome: string): string | null }, hops: number, socket?: string | null): string {
  if (!Number.isInteger(hops) || hops < 0) throw new RangeError('hops inválido');
  if (hops === 0) return normalizar(socket) ?? IP_DESCONHECIDO;
  const entradas = (h.get('x-forwarded-for') ?? '').split(',');
  if (entradas.length < hops) return IP_DESCONHECIDO;
  return normalizar(entradas[entradas.length - hops]) ?? IP_DESCONHECIDO;
}
