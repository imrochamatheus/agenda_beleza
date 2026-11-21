import { randomBytes, randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { ErroDeChaveAdmin, ErroDeDecifragem, chaveDoAmbiente, cifrarSegredo, decifrarSegredo, lerChave } from './cifra';

// CA-5: AES-256-GCM com AAD = usuário; formato v1 e erros que não vazam valores.
const chave = randomBytes(32);
const usuario = randomUUID();
const SEGREDO = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('cifra do segredo', () => {
  it('cifra no formato v1 sem conter o segredo e decifra com a chave e o AAD certos', () => {
    const c = cifrarSegredo(SEGREDO, usuario, chave);
    expect(c).toMatch(/^v1:[\w-]{16}:[\w-]{22}:[\w-]+$/);
    expect(c).not.toContain(SEGREDO);
    expect(decifrarSegredo(c, usuario, chave)).toBe(SEGREDO);
  });
  it('usa IV novo a cada gravação', () => {
    expect(cifrarSegredo(SEGREDO, usuario, chave)).not.toBe(cifrarSegredo(SEGREDO, usuario, chave));
  });
  it('falha com chave errada, AAD de outro usuário, adulteração e formato inválido', () => {
    const c = cifrarSegredo(SEGREDO, usuario, chave);
    expect(() => decifrarSegredo(c, usuario, randomBytes(32))).toThrow(ErroDeDecifragem);
    expect(() => decifrarSegredo(c, randomUUID(), chave)).toThrow(ErroDeDecifragem);
    const partes = c.split(':');
    partes[3] = Buffer.from('xx').toString('base64url');
    expect(() => decifrarSegredo(partes.join(':'), usuario, chave)).toThrow(ErroDeDecifragem);
    partes[1] = 'curto';
    expect(() => decifrarSegredo(partes.join(':'), usuario, chave)).toThrow(ErroDeDecifragem);
    expect(() => decifrarSegredo('segredo-cifrado-ficticio', usuario, chave)).toThrow(ErroDeDecifragem);
    expect(() => decifrarSegredo(c.replace('v1:', 'v2:'), usuario, chave)).toThrow(ErroDeDecifragem);
  });
});

describe('lerChave', () => {
  it('aceita base64 e 64 hexadecimais de 32 bytes', () => {
    expect(lerChave(chave.toString('base64')).equals(chave)).toBe(true);
    expect(lerChave(chave.toString('hex')).equals(chave)).toBe(true);
    expect(lerChave(` ${chave.toString('base64url')} `).equals(chave)).toBe(true);
  });
  it('recusa ausente, tamanho errado e lixo, sem citar o valor', () => {
    const lixo = 'segredo-que-nao-deve-vazar';
    for (const ruim of [undefined, '', lixo, randomBytes(16).toString('base64'), randomBytes(33).toString('hex')]) {
      expect(() => lerChave(ruim)).toThrow(ErroDeChaveAdmin);
    }
    try {
      lerChave(lixo);
    } catch (e) {
      expect(String((e as Error).message)).not.toContain(lixo);
    }
  });
  it('chaveDoAmbiente lê só ADMIN_TOTP_CHAVE', () => {
    expect(chaveDoAmbiente({ ADMIN_TOTP_CHAVE: chave.toString('hex') }).equals(chave)).toBe(true);
    expect(() => chaveDoAmbiente({})).toThrow(ErroDeChaveAdmin);
  });
});
