import { describe, expect, it } from 'vitest';

import {
  INATIVIDADE_MS,
  INTERVALO_RENOVACAO_MS,
  TETO_MS,
  expiracaoInicial,
  novaExpiracao,
  precisaRenovar,
} from './validade';

// RN-10 (D-1): 7 d de inatividade, teto de 30 d, no máximo uma renovação por hora.
const HORA = 60 * 60 * 1000;
const DIA = 24 * HORA;
const T0 = new Date('2026-11-01T12:00:00.000Z');
const mais = (ms: number) => new Date(T0.getTime() + ms);

describe('RN-10: validade da sessão', () => {
  it('constantes: 7 d, 30 d e 1 h', () => {
    expect(INATIVIDADE_MS).toBe(7 * DIA);
    expect(TETO_MS).toBe(30 * DIA);
    expect(INTERVALO_RENOVACAO_MS).toBe(HORA);
  });

  it('expiração inicial = agora + 7 d', () => {
    expect(expiracaoInicial(T0)).toEqual(mais(7 * DIA));
  });

  it('precisaRenovar: null → sim; há exatamente 1 h → não; há mais de 1 h → sim', () => {
    expect(precisaRenovar(null, T0)).toBe(true);
    expect(precisaRenovar(T0, mais(HORA - 1))).toBe(false);
    expect(precisaRenovar(T0, mais(HORA))).toBe(false);
    expect(precisaRenovar(T0, mais(HORA + 1))).toBe(true);
  });

  it('novaExpiracao: agora + 7 d, limitada a criadoEm + 30 d', () => {
    expect(novaExpiracao(T0, mais(6 * DIA))).toEqual(mais(13 * DIA));
    expect(novaExpiracao(T0, mais(23 * DIA))).toEqual(mais(30 * DIA));
    expect(novaExpiracao(T0, mais(29 * DIA))).toEqual(mais(30 * DIA));
  });
});
