import { describe, expect, it } from 'vitest';

import { dentroDoLimite, isoDaData, lerDataIso, lerParametros, lerVisao } from './validacao';

// D-028 T-1 (RN-12, CA-15): parâmetros inválidos caem no padrão, nunca em erro.
const HOJE = { ano: 2026, mes: 11, dia: 21 };

describe('lerDataIso', () => {
  it('aceita AAAA-MM-DD válida e recusa o resto', () => {
    expect(lerDataIso('2026-12-01')).toEqual({ ano: 2026, mes: 12, dia: 1 });
    expect(lerDataIso('2028-02-29')).toEqual({ ano: 2028, mes: 2, dia: 29 });
    for (const ruim of ['2026-02-30', '2026-13-01', '26-01-01', '2026-1-1', '', undefined, null, 20261201, ['2026-12-01'], '2026-12-01x']) {
      expect(lerDataIso(ruim)).toBeNull();
    }
  });
  it('isoDaData é a inversa', () => {
    expect(isoDaData({ ano: 2026, mes: 1, dia: 5 })).toBe('2026-01-05');
  });
});

describe('limite de ±5 anos', () => {
  it('aceita a borda e recusa além dela', () => {
    expect(dentroDoLimite({ ano: 2031, mes: 11, dia: 21 }, HOJE)).toBe(true);
    expect(dentroDoLimite({ ano: 2021, mes: 11, dia: 21 }, HOJE)).toBe(true);
    expect(dentroDoLimite({ ano: 2032, mes: 11, dia: 30 }, HOJE)).toBe(false);
    expect(dentroDoLimite({ ano: 2020, mes: 1, dia: 1 }, HOJE)).toBe(false);
  });
});

describe('lerVisao e lerParametros', () => {
  it('visão desconhecida ou repetida → dia', () => {
    expect(lerVisao('semana')).toBe('semana');
    expect(lerVisao('dia')).toBe('dia');
    for (const v of ['mes', '', undefined, ['semana'], 3]) expect(lerVisao(v)).toBe('dia');
  });
  it('data inválida ou fora do limite → hoje; válida é mantida', () => {
    expect(lerParametros({ data: '2026-12-01' }, HOJE).data).toEqual({ ano: 2026, mes: 12, dia: 1 });
    for (const d of ['lixo', '2026-02-30', '2099-01-01', '1999-01-01', undefined, ['2026-12-01']]) {
      expect(lerParametros({ data: d }, HOJE).data).toEqual(HOJE);
    }
  });
  it('profissional: texto aparado ou null; não texto → null', () => {
    expect(lerParametros({ profissional: ' abc ' }, HOJE).profissional).toBe('abc');
    for (const p of ['', '   ', undefined, 5, ['a']]) expect(lerParametros({ profissional: p }, HOJE).profissional).toBeNull();
  });
});
