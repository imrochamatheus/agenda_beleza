// Chaves de `rate_limit_janela` (D-027 RN-1): nunca IP nem telefone em claro.
import { createHash, createHmac } from 'node:crypto';

import { segredoDoLimite } from './config';
import type { EscopoIp } from './tipos';

export function chaveIp(escopo: EscopoIp, ip: string): string {
  return `pub:${escopo}:ip:${createHash('sha256').update(ip).digest('hex')}`;
}

/** HMAC do E.164 com o salão: o mesmo número em salões diferentes tem contadores diferentes. */
export function chaveNumero(salaoId: string, e164: string, segredo: string = segredoDoLimite()): string {
  return `pub:reserva:tel:${createHmac('sha256', segredo).update(`${salaoId}:${e164}`).digest('hex')}`;
}
