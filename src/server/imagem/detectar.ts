// Detecção do tipo da imagem só pelos bytes iniciais (D-021 §3.3; RN-5). Puro, sem sharp.

export type TipoImagem = 'jpeg' | 'png' | 'webp';

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function comeca(bytes: Uint8Array, assinatura: readonly number[], deslocamento = 0): boolean {
  return bytes.length >= deslocamento + assinatura.length && assinatura.every((b, i) => bytes[deslocamento + i] === b);
}

/** Nunca usa extensão, nome ou Content-Type. */
export function detectarTipo(bytes: Uint8Array): TipoImagem | null {
  if (comeca(bytes, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (comeca(bytes, PNG)) return 'png';
  if (comeca(bytes, [0x52, 0x49, 0x46, 0x46]) && comeca(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return 'webp';
  return null;
}
