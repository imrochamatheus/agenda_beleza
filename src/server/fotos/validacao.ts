// Validação pura das fotos (D-021 §3.4; RN-9, RN-11, RN-18). Sem next/*, Prisma nem SDKs.
import { normalizarNome } from '@/lib/texto';

import { LIMITES_FOTO, MENSAGENS_FOTO } from './tipos';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export function ehUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID.test(v);
}

export type ResultadoAltValidado =
  | { ok: true; alt: string }
  | { ok: false; codigo: 'alt_vazio' | 'alt_longo'; erro: string };

/** RN-9: normaliza como `normalizarNome`; 1 a 150 UTF-16; controle (inclui quebra de linha) é recusado. */
export function validarAlt(texto: unknown): ResultadoAltValidado {
  if (typeof texto === 'string' && texto.trim().replace(/\s+/gu, ' ').length > LIMITES_FOTO.maxAlt && !/\p{Cc}/u.test(texto)) {
    return { ok: false, codigo: 'alt_longo', erro: MENSAGENS_FOTO.alt_longo };
  }
  const n = normalizarNome(texto, { min: 1, max: LIMITES_FOTO.maxAlt });
  if (n === null) {
    return { ok: false, codigo: 'alt_vazio', erro: MENSAGENS_FOTO.alt_vazio };
  }
  return { ok: true, alt: n };
}

/** RN-18: token de envio (UUID). */
export function validarEnvioToken(v: unknown): string | null {
  return ehUuid(v) ? v.toLowerCase() : null;
}

/** RN-11: posição esperada, inteiro 1..12. */
export function validarPosicaoEsperada(v: unknown): number | null {
  const n = typeof v === 'string' && /^\d{1,2}$/u.test(v) ? Number(v) : v;
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= LIMITES_FOTO.maxFotos ? n : null;
}
