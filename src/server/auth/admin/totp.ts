import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// TOTP (RFC 6238, HMAC-SHA1) do super admin (D-034 RN-3). Puro: sem I/O, sem relógio implícito
// (`agora` é entrada) e sem Date local. Só node:crypto.

const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const PASSO_SEGUNDOS = 30;
export const DIGITOS = 6;
export const BYTES_DO_SEGREDO = 20;
/** Tolerância de ±1 passo (30 s) em torno do passo atual. */
export const TOLERANCIA_PASSOS = 1;

/** Base32 RFC 4648 sem padding. */
export function base32Codificar(dados: Uint8Array): string {
  let bits = 0;
  let valor = 0;
  let saida = '';
  for (const byte of dados) {
    valor = (valor << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      saida += ALFABETO[(valor >>> (bits - 5)) & 31];
      bits -= 5;
    }
    valor &= (1 << bits) - 1;
  }
  if (bits > 0) {
    saida += ALFABETO[(valor << (5 - bits)) & 31];
  }
  return saida;
}

/** Decodifica base32 (maiúsculas, sem padding). Caractere fora do alfabeto lança. */
export function base32Decodificar(texto: string): Buffer {
  const bytes: number[] = [];
  let bits = 0;
  let valor = 0;
  for (const c of texto) {
    const indice = ALFABETO.indexOf(c);
    if (indice < 0) {
      throw new RangeError('base32 inválido');
    }
    valor = (valor << 5) | indice;
    bits += 5;
    if (bits >= 8) {
      bytes.push((valor >>> (bits - 8)) & 255);
      bits -= 8;
      valor &= (1 << bits) - 1;
    }
  }
  return Buffer.from(bytes);
}

/** Segredo novo: 20 bytes aleatórios em base32 (32 caracteres). */
export function gerarSegredo(): string {
  return base32Codificar(randomBytes(BYTES_DO_SEGREDO));
}

/** Contador do passo de 30 s em epoch UTC (independe do fuso do processo). */
export function passoDe(agora: Date): number {
  return Math.floor(agora.getTime() / 1000 / PASSO_SEGUNDOS);
}

/** Código do passo (RFC 4226 truncamento dinâmico). `digitos` só varia nos vetores de teste. */
export function codigoDoPasso(segredoBase32: string, passo: number, digitos: number = DIGITOS): string {
  const contador = Buffer.alloc(8);
  contador.writeBigUInt64BE(BigInt(passo));
  const hmac = createHmac('sha1', base32Decodificar(segredoBase32)).update(contador).digest();
  const deslocamento = hmac[hmac.length - 1] & 0x0f;
  const binario = hmac.readUInt32BE(deslocamento) & 0x7fffffff;
  return String(binario % 10 ** digitos).padStart(digitos, '0');
}

/** Aceita só 6 dígitos ASCII depois de aparar espaços e hífens (Unicode fora disso é recusado). */
export function normalizarCodigo(entrada: unknown): string | null {
  if (typeof entrada !== 'string' || entrada.length > 32) {
    return null;
  }
  const limpo = entrada.replace(/[\s-]/g, '');
  return /^[0-9]{6}$/.test(limpo) ? limpo : null;
}

/**
 * Passo cujo código confere (±1), ou null. Compara os três em tempo constante, sem curto-circuito;
 * havendo coincidência entre passos vizinhos, devolve o maior.
 */
export function verificarCodigo(segredoBase32: string, codigo: string, agora: Date): number | null {
  const normalizado = normalizarCodigo(codigo);
  if (normalizado === null) {
    return null;
  }
  const alvo = Buffer.from(normalizado, 'utf8');
  const atual = passoDe(agora);
  let achado: number | null = null;
  for (let delta = -TOLERANCIA_PASSOS; delta <= TOLERANCIA_PASSOS; delta += 1) {
    const passo = atual + delta;
    if (passo < 0) {
      continue;
    }
    const candidato = Buffer.from(codigoDoPasso(segredoBase32, passo), 'utf8');
    if (timingSafeEqual(candidato, alvo)) {
      achado = passo;
    }
  }
  return achado;
}

/** Chave em grupos de 4 para leitura humana (fallback do QR). */
export function agruparChave(segredo: string): string {
  return segredo.replace(/(.{4})(?=.)/g, '$1 ');
}

export const EMISSOR = 'Agenda Beleza';

/** URI otpauth para os aplicativos autenticadores. */
export function uriOtpauth(email: string, segredoBase32: string): string {
  const emissor = encodeURIComponent(EMISSOR);
  return (
    `otpauth://totp/${emissor}:${encodeURIComponent(email)}` +
    `?secret=${segredoBase32}&issuer=${emissor}&algorithm=SHA1&digits=${DIGITOS}&period=${PASSO_SEGUNDOS}`
  );
}
