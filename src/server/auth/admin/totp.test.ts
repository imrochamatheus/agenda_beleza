import { describe, expect, it } from 'vitest';

import {
  agruparChave,
  base32Codificar,
  base32Decodificar,
  codigoDoPasso,
  gerarSegredo,
  normalizarCodigo,
  passoDe,
  uriOtpauth,
  verificarCodigo,
} from './totp';

// CA-6: vetores do RFC 6238 (SHA-1; segredo ASCII "12345678901234567890"), tolerância e formato.
const SEGREDO_RFC = base32Codificar(Buffer.from('12345678901234567890', 'ascii'));
const t = (s: number) => new Date(s * 1000);

describe('base32', () => {
  it('codifica o segredo do RFC e decodifica de volta', () => {
    expect(SEGREDO_RFC).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(base32Decodificar(SEGREDO_RFC).toString('ascii')).toBe('12345678901234567890');
    expect(base32Codificar(Buffer.from('f'))).toBe('MY');
  });
  it('recusa caractere fora do alfabeto', () => {
    expect(() => base32Decodificar('abc1')).toThrow(RangeError);
  });
});

describe('codigoDoPasso (vetores RFC 6238)', () => {
  const vetores: [number, string][] = [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ];
  it.each(vetores)('T=%i → %s (8 dígitos) e os 6 últimos conferem', (segundos, oito) => {
    const passo = passoDe(t(segundos));
    expect(codigoDoPasso(SEGREDO_RFC, passo, 8)).toBe(oito);
    expect(codigoDoPasso(SEGREDO_RFC, passo)).toBe(oito.slice(2));
  });
});

describe('verificarCodigo', () => {
  const agora = t(1111111111);
  const passo = passoDe(agora);
  const codigoDe = (p: number) => codigoDoPasso(SEGREDO_RFC, p);

  it('aceita t-30, t e t+30 e devolve o passo do código', () => {
    expect(verificarCodigo(SEGREDO_RFC, codigoDe(passo), agora)).toBe(passo);
    expect(verificarCodigo(SEGREDO_RFC, codigoDe(passo - 1), agora)).toBe(passo - 1);
    expect(verificarCodigo(SEGREDO_RFC, codigoDe(passo + 1), agora)).toBe(passo + 1);
  });
  it('recusa t-60 e t+60', () => {
    expect(verificarCodigo(SEGREDO_RFC, codigoDe(passo - 2), agora)).toBeNull();
    expect(verificarCodigo(SEGREDO_RFC, codigoDe(passo + 2), agora)).toBeNull();
  });
  it('apara espaços e hífens e recusa formato inválido', () => {
    const c = codigoDe(passo);
    expect(verificarCodigo(SEGREDO_RFC, ` ${c.slice(0, 3)}-${c.slice(3)} `, agora)).toBe(passo);
    for (const ruim of ['', '12345', '1234567', 'abcdef', '１２３４５６', '12 34 5x']) {
      expect(verificarCodigo(SEGREDO_RFC, ruim, agora)).toBeNull();
    }
    expect(normalizarCodigo(123456 as unknown)).toBeNull();
    expect(normalizarCodigo('1'.repeat(40))).toBeNull();
  });
  it('não depende do passo negativo (epoch 0)', () => {
    expect(verificarCodigo(SEGREDO_RFC, codigoDe(0), new Date(0))).toBe(0);
  });
});

describe('segredo e URI', () => {
  it('gera 32 caracteres base32 distintos', () => {
    const a = gerarSegredo();
    expect(a).toMatch(/^[A-Z2-7]{32}$/);
    expect(gerarSegredo()).not.toBe(a);
  });
  it('agrupa em 4', () => {
    expect(agruparChave('ABCDEFGHIJ')).toBe('ABCD EFGH IJ');
  });
  it('monta a URI otpauth', () => {
    expect(uriOtpauth('a+b@x.test', 'ABC')).toBe(
      'otpauth://totp/Agenda%20Beleza:a%2Bb%40x.test?secret=ABC&issuer=Agenda%20Beleza&algorithm=SHA1&digits=6&period=30',
    );
  });
});
