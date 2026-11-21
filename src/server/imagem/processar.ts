// Reprocessamento da imagem (D-021 §3.3; RN-6, RN-7). ÚNICO import de 'sharp' do projeto (lint).
import sharp from 'sharp';

import type { TipoImagem } from './detectar';

export const MAIOR_LADO = 1600;
export const QUALIDADE_WEBP = 82;
export const LIMITE_PIXELS = 50_000_000;
/** A-7: decodificações simultâneas por processo. */
export const MAX_SIMULTANEAS = 2;

export type ImagemProcessada = { bytes: Uint8Array; largura: number; altura: number };
export type ResultadoProcessamento = { ok: true; imagem: ImagemProcessada } | { ok: false; erro: 'ilegivel' | 'resolucao' };

sharp.cache(false);

// Semáforo em processo (A-7): 50 MP decodificados ocupam centenas de MB.
let ativas = 0;
const espera: Array<() => void> = [];
async function adquirir(): Promise<void> {
  if (ativas < MAX_SIMULTANEAS) {
    ativas += 1;
    return;
  }
  await new Promise<void>((ok) => espera.push(ok));
}
function liberar(): void {
  const proximo = espera.shift();
  if (proximo) proximo(); // a vaga passa direto ao próximo
  else ativas -= 1;
}

/** Quantas decodificações estão em andamento (testes). */
export function decodificacoesAtivas(): number {
  return ativas;
}

async function converter(bytes: Uint8Array, tipo: TipoImagem): Promise<ResultadoProcessamento> {
  try {
    const entrada = sharp(bytes, { failOn: 'truncated', limitInputPixels: LIMITE_PIXELS });
    const meta = await entrada.metadata();
    if (meta.format !== tipo) return { ok: false, erro: 'ilegivel' };
    const { data, info } = await entrada
      .rotate()
      .resize({ width: MAIOR_LADO, height: MAIOR_LADO, fit: 'inside', withoutEnlargement: true })
      .toColourspace('srgb')
      .webp({ quality: QUALIDADE_WEBP })
      .toBuffer({ resolveWithObject: true });
    return { ok: true, imagem: { bytes: new Uint8Array(data), largura: info.width, altura: info.height } };
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    return { ok: false, erro: /pixel limit/iu.test(msg) ? 'resolucao' : 'ilegivel' };
  }
}

export async function processarImagem(bytes: Uint8Array, tipo: TipoImagem): Promise<ResultadoProcessamento> {
  await adquirir();
  try {
    return await converter(bytes, tipo);
  } finally {
    liberar();
  }
}
