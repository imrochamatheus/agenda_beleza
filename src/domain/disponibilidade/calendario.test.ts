import { describe, expect, it } from 'vitest';

import { datasDoPeriodo, diaDaSemana, gradeDoDia, limitesDaJanela, periodoDeLeitura } from './calendario';
import { AGORA, D, REGRAS_SP, iso, sp } from './apoio';

describe('diaDaSemana', () => {
  it('0 = domingo', () => {
    expect(diaDaSemana(D(2026, 11, 29))).toBe(0);
    expect(diaDaSemana(D(2026, 12, 1))).toBe(2);
    expect(diaDaSemana(D(2026, 12, 5))).toBe(6);
  });
});

describe('datasDoPeriodo', () => {
  it('uma data, atravessando mês e ano bissexto', () => {
    expect(datasDoPeriodo(D(2026, 12, 1), D(2026, 12, 1))).toEqual([D(2026, 12, 1)]);
    expect(datasDoPeriodo(D(2026, 12, 30), D(2027, 1, 2))).toEqual([D(2026, 12, 30), D(2026, 12, 31), D(2027, 1, 1), D(2027, 1, 2)]);
    expect(datasDoPeriodo(D(2028, 2, 28), D(2028, 3, 1))).toEqual([D(2028, 2, 28), D(2028, 2, 29), D(2028, 3, 1)]);
    expect(datasDoPeriodo(D(2026, 1, 1), D(2026, 12, 31))).toHaveLength(365);
  });
  it('ate < de lança RangeError', () => {
    expect(() => datasDoPeriodo(D(2026, 12, 2), D(2026, 12, 1))).toThrow(RangeError);
  });
});

describe('limitesDaJanela', () => {
  it('hoje é a data local de agora; última = hoje + janela', () => {
    expect(limitesDaJanela(AGORA, REGRAS_SP)).toEqual({ hoje: D(2026, 11, 20), ultima: D(2027, 1, 19) });
    // 2026-11-21T01:00Z ainda é 20/11 em São Paulo.
    expect(limitesDaJanela(iso('2026-11-21T01:00:00Z'), REGRAS_SP).hoje).toEqual(D(2026, 11, 20));
    expect(limitesDaJanela(AGORA, { ...REGRAS_SP, janelaDias: 0 }).ultima).toEqual(D(2026, 11, 20));
  });
});

describe('periodoDeLeitura', () => {
  it('A-7: 00:00 local de d1 até 00:00 local de d2+1 mais o intervalo', () => {
    const p = periodoDeLeitura(D(2026, 12, 1), D(2026, 12, 2), { ...REGRAS_SP, intervaloMin: 30 });
    expect(p.de).toEqual(sp(D(2026, 12, 1), '00:00'));
    expect(p.ate).toEqual(sp(D(2026, 12, 3), '00:30'));
    expect(periodoDeLeitura(D(2026, 12, 1), D(2026, 12, 1), REGRAS_SP).ate).toEqual(sp(D(2026, 12, 2), '00:00'));
  });
});

describe('gradeDoDia', () => {
  it('múltiplos da grade a partir de 00:00 e instantes em ordem', () => {
    const g = gradeDoDia(D(2026, 12, 1), { ...REGRAS_SP, gradeMin: 60 });
    expect(g.map((c) => c.minutosDoDia)).toEqual(Array.from({ length: 24 }, (_, i) => i * 60));
    expect(g[9].instante).toBe(sp(D(2026, 12, 1), '09:00').getTime());
  });
  it('restringe a [mínimo, máximo) e alinha o mínimo à grade', () => {
    const g = gradeDoDia(D(2026, 12, 1), REGRAS_SP, 545, 600);
    expect(g.map((c) => c.minutosDoDia)).toEqual([555, 570, 585]);
  });
  it('máximo acima de 1440 não passa de 23:xx', () => {
    expect(gradeDoDia(D(2026, 12, 1), { ...REGRAS_SP, gradeMin: 720 }, 0, 5000).map((c) => c.minutosDoDia)).toEqual([0, 720]);
  });
  it('descarta a hora inexistente do salto (America/New_York)', () => {
    const g = gradeDoDia(D(2026, 3, 8), { ...REGRAS_SP, fuso: 'America/New_York', gradeMin: 60 }, 0, 240);
    expect(g.map((c) => c.minutosDoDia)).toEqual([0, 60, 180]);
  });
});
