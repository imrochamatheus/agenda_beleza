import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// Cifra do segredo TOTP (D-034 RN-5): AES-256-GCM, IV de 12 B aleatório por gravação, AAD = id do
// usuário (o texto cifrado de um usuário não vale para outro). Formato `v1:<iv>:<tag>:<cifra>` em
// base64url. Nenhuma mensagem de erro cita chave, segredo ou texto cifrado.

const VERSAO = 'v1';
const TAMANHO_IV = 12;
const TAMANHO_TAG = 16;
const TAMANHO_CHAVE = 32;

export class ErroDeChaveAdmin extends Error {
  constructor() {
    super('ADMIN_TOTP_CHAVE ausente ou inválida (esperados 32 bytes em base64 ou 64 hexadecimais)');
    this.name = 'ErroDeChaveAdmin';
  }
}

export class ErroDeDecifragem extends Error {
  constructor() {
    super('não foi possível decifrar o segredo');
    this.name = 'ErroDeDecifragem';
  }
}

/** 32 bytes a partir de 64 hexadecimais ou de base64/base64url. Lança sem citar o valor. */
export function lerChave(valor: string | undefined): Buffer {
  if (typeof valor !== 'string') {
    throw new ErroDeChaveAdmin();
  }
  const texto = valor.trim();
  const chave = /^[0-9a-fA-F]{64}$/.test(texto)
    ? Buffer.from(texto, 'hex')
    : /^[A-Za-z0-9+/_-]+={0,2}$/.test(texto)
      ? Buffer.from(texto, 'base64')
      : Buffer.alloc(0);
  if (chave.length !== TAMANHO_CHAVE) {
    throw new ErroDeChaveAdmin();
  }
  return chave;
}

/** Chave do ambiente (única leitura de ADMIN_TOTP_CHAVE no código de produção). */
export function chaveDoAmbiente(fonte: Record<string, string | undefined> = process.env): Buffer {
  return lerChave(fonte.ADMIN_TOTP_CHAVE);
}

export function cifrarSegredo(segredo: string, usuarioId: string, chave: Buffer): string {
  const iv = randomBytes(TAMANHO_IV);
  const cifra = createCipheriv('aes-256-gcm', chave, iv, { authTagLength: TAMANHO_TAG });
  cifra.setAAD(Buffer.from(usuarioId, 'utf8'));
  const dados = Buffer.concat([cifra.update(segredo, 'utf8'), cifra.final()]);
  return [VERSAO, iv.toString('base64url'), cifra.getAuthTag().toString('base64url'), dados.toString('base64url')].join(':');
}

/** Lança ErroDeDecifragem para formato, versão, chave, AAD ou conteúdo adulterados. */
export function decifrarSegredo(cifrado: string, usuarioId: string, chave: Buffer): string {
  const partes = cifrado.split(':');
  if (partes.length !== 4 || partes[0] !== VERSAO) {
    throw new ErroDeDecifragem();
  }
  try {
    const iv = Buffer.from(partes[1], 'base64url');
    const tag = Buffer.from(partes[2], 'base64url');
    if (iv.length !== TAMANHO_IV || tag.length !== TAMANHO_TAG) {
      throw new ErroDeDecifragem();
    }
    const decifra = createDecipheriv('aes-256-gcm', chave, iv, { authTagLength: TAMANHO_TAG });
    decifra.setAAD(Buffer.from(usuarioId, 'utf8'));
    decifra.setAuthTag(tag);
    return Buffer.concat([decifra.update(Buffer.from(partes[3], 'base64url')), decifra.final()]).toString('utf8');
  } catch {
    throw new ErroDeDecifragem();
  }
}
