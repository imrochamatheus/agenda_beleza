import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { DDDS_BRASIL, ehTelefoneBrE164, normalizarTelefoneBr, TELEFONE_MAX_CARACTERES } from './telefone';

// D-020 T-2: RN-7, CA-2 (telefone) e CA-18 (lista de DDDs, normalizador puro).

describe('DDDS_BRASIL', () => {
  it('67 DDDs da Anatel', () => {
    expect(DDDS_BRASIL.size).toBe(67);
    for (const ddd of ['11', '19', '21', '22', '24', '27', '28', '31', '38', '41', '49', '51', '53', '55', '61', '69', '71', '73', '79', '81', '89', '91', '99']) {
      expect(DDDS_BRASIL.has(ddd), ddd).toBe(true);
    }
    for (const ddd of ['00', '01', '10', '20', '23', '25', '26', '29', '30', '36', '39', '40', '50', '52', '56', '60', '70', '72', '76', '78', '80', '90']) {
      expect(DDDS_BRASIL.has(ddd), ddd).toBe(false);
    }
  });
});

describe('normalizarTelefoneBr (RN-7)', () => {
  it.each([
    ['(11) 3456-7890', '+551134567890'],
    ['11987654321', '+5511987654321'],
    ['+55 11 98765-4321', '+5511987654321'],
    ['+55 (11) 3456.7890', '+551134567890'],
    ['  11 2345 6789  ', '+551123456789'],
    ['551134567890', '+551134567890'],
    ['5511987654321', '+5511987654321'],
    ['+5511987654321', '+5511987654321'],
    ['(55) 3456-7890', '+555534567890'],
    ['(55) 99876-5432', '+5555998765432'],
    ['5555998765432', '+5555998765432'],
    ['(99) 5234-5678', '+559952345678'],
  ])('%s → %s', (entrada, esperado) => {
    expect(normalizarTelefoneBr(entrada)).toBe(esperado);
  });

  it.each([
    ['outro país', '+1 212 555 0100'],
    ['DDD 00', '(00) 3456-7890'],
    ['0800', '0800 123 4567'],
    ['0300', '0300 123 4567'],
    ['4004', '4004-1234'],
    ['9 dígitos', '(11) 8765-432'],
    ['11 dígitos sem 9', '(11) 88765-4321'],
    ['fixo começando por 6', '(11) 6456-7890'],
    ['fixo começando por 1', '(11) 1456-7890'],
    ['letras', '(11) 3456-ABCD'],
    ['+ no meio', '11+5534567890'],
    ['++55', '++55 11 3456-7890'],
    ['+ sem 55', '+11 3456-7890'],
    ['DDD inexistente 20', '(20) 3456-7890'],
    ['vazio', ''],
    ['só separadores', '() -'],
    ['12 dígitos sem 55', '441134567890'],
    ['55 + 9 dígitos', '55113456789'],
    ['acima do limite', '1'.repeat(TELEFONE_MAX_CARACTERES + 1)],
  ])('%s → null', (_n, v) => {
    expect(normalizarTelefoneBr(v)).toBeNull();
  });

  it('não texto → null, nunca lança', () => {
    for (const v of [undefined, null, 11987654321, [], {}, true]) expect(normalizarTelefoneBr(v)).toBeNull();
  });
});

describe('ehTelefoneBrE164', () => {
  it('aceita só o formato gravado', () => {
    expect(ehTelefoneBrE164('+551134567890')).toBe(true);
    expect(ehTelefoneBrE164('+5511987654321')).toBe(true);
    for (const v of ['551134567890', '+5520345678901', '+5511887654321', '+551164567890', ' +551134567890', 551134567890]) {
      expect(ehTelefoneBrE164(v), String(v)).toBe(false);
    }
  });
});

describe('pureza (CA-18)', () => {
  it('telefone.ts não importa nada', () => {
    const texto = readFileSync(fileURLToPath(new URL('./telefone.ts', import.meta.url)), 'utf8');
    expect(texto).not.toMatch(/^\s*import\s/m);
  });
});
