import { describe, expect, it } from 'vitest';

import {
  compararDatas,
  diferencaEmDias,
  ehDataCivilValida,
  ehDiaInteiro,
  instanteDeHoraLocal,
  intervaloDeDiasInteiros,
  partesLocais,
  somarDias,
  validarFuso,
} from './fuso';

// D-016 T-1: conversão hora local ↔ UTC (CA-3, CA-5, CA-6, R-1). Os resultados não dependem do fuso do
// processo: rodar também com TZ=UTC e TZ=America/Sao_Paulo (dev.md).

const SP = 'America/Sao_Paulo';
const NY = 'America/New_York';
const MANAUS = 'America/Manaus';
const iso = (d: Date) => d.toISOString();
const data = (dia: number, mes: number, ano: number) => ({ ano, mes, dia });

describe('CA-6: instanteDeHoraLocal e intervaloDeDiasInteiros', () => {
  it('(a) São Paulo, dia inteiro 25/12/2026 → [03:00Z de 25/12, 03:00Z de 26/12) (CA-3)', () => {
    const r = intervaloDeDiasInteiros(data(25, 12, 2026), data(25, 12, 2026), SP);
    expect([iso(r.inicio), iso(r.fim)]).toEqual(['2026-12-25T03:00:00.000Z', '2026-12-26T03:00:00.000Z']);
  });

  it('(b) São Paulo, 04/11/2018 (início do horário de verão, dia de 23 h)', () => {
    const r = intervaloDeDiasInteiros(data(4, 11, 2018), data(4, 11, 2018), SP);
    expect([iso(r.inicio), iso(r.fim)]).toEqual(['2018-11-04T03:00:00.000Z', '2018-11-05T02:00:00.000Z']);
    expect(r.fim.getTime() - r.inicio.getTime()).toBe(23 * 3_600_000);
  });

  it('(c) São Paulo, 17/02/2018 (fim do horário de verão, dia de 25 h)', () => {
    const r = intervaloDeDiasInteiros(data(17, 2, 2018), data(17, 2, 2018), SP);
    expect([iso(r.inicio), iso(r.fim)]).toEqual(['2018-02-17T02:00:00.000Z', '2018-02-18T03:00:00.000Z']);
    expect(r.fim.getTime() - r.inicio.getTime()).toBe(25 * 3_600_000);
  });

  it('(d) Nova York, 08/03/2026 02:30 (inexistente) → 07:00Z (03:00 EDT, primeiro instante válido)', () => {
    expect(iso(instanteDeHoraLocal(data(8, 3, 2026), 150, NY))).toBe('2026-03-08T07:00:00.000Z');
    expect(iso(instanteDeHoraLocal(data(8, 3, 2026), 120, NY))).toBe('2026-03-08T07:00:00.000Z');
    expect(iso(instanteDeHoraLocal(data(8, 3, 2026), 175, NY))).toBe('2026-03-08T07:00:00.000Z');
    expect(iso(instanteDeHoraLocal(data(8, 3, 2026), 180, NY))).toBe('2026-03-08T07:00:00.000Z');
    expect(iso(instanteDeHoraLocal(data(8, 3, 2026), 115, NY))).toBe('2026-03-08T06:55:00.000Z');
  });

  it('(e) Nova York, 01/11/2026 01:30 (repetida) → 05:30Z (primeira ocorrência, EDT)', () => {
    expect(iso(instanteDeHoraLocal(data(1, 11, 2026), 90, NY))).toBe('2026-11-01T05:30:00.000Z');
    expect(iso(instanteDeHoraLocal(data(1, 11, 2026), 120, NY))).toBe('2026-11-01T07:00:00.000Z');
  });

  it('São Paulo 04/11/2018 00:00 (inexistente) → 01:00 local = 03:00Z (RN-3)', () => {
    expect(iso(instanteDeHoraLocal(data(4, 11, 2018), 0, SP))).toBe('2018-11-04T03:00:00.000Z');
    expect(iso(instanteDeHoraLocal(data(4, 11, 2018), 30, SP))).toBe('2018-11-04T03:00:00.000Z');
    expect(iso(instanteDeHoraLocal(data(4, 11, 2018), 60, SP))).toBe('2018-11-04T03:00:00.000Z');
    // 17/02/2018 23:30 se repete: primeira ocorrência (-02:00).
    expect(iso(instanteDeHoraLocal(data(17, 2, 2018), 23 * 60 + 30, SP))).toBe('2018-02-18T01:30:00.000Z');
  });

  it('(f) fuso inexistente, vazio ou não-string → RangeError', () => {
    for (const fuso of ['Foo/Bar', '', 42 as unknown as string, undefined as unknown as string]) {
      expect(() => instanteDeHoraLocal(data(1, 1, 2026), 0, fuso)).toThrow(RangeError);
      expect(() => validarFuso(fuso)).toThrow(/Fuso horário inválido/);
    }
    expect(validarFuso(SP)).toBe(SP);
  });

  it('CA-5: São Paulo 25/12 22:00 → 01:00Z de 26/12; 26/12 02:00 → 05:00Z; Manaus 10:00 → 14:00Z', () => {
    expect(iso(instanteDeHoraLocal(data(25, 12, 2026), 22 * 60, SP))).toBe('2026-12-26T01:00:00.000Z');
    expect(iso(instanteDeHoraLocal(data(26, 12, 2026), 2 * 60, SP))).toBe('2026-12-26T05:00:00.000Z');
    expect(iso(instanteDeHoraLocal(data(25, 12, 2026), 10 * 60, MANAUS))).toBe('2026-12-25T14:00:00.000Z');
    expect(iso(instanteDeHoraLocal(data(25, 12, 2026), 12 * 60, MANAUS))).toBe('2026-12-25T16:00:00.000Z');
  });

  it('UTC e Asia/Kolkata (+05:30)', () => {
    expect(iso(instanteDeHoraLocal(data(1, 1, 2026), 0, 'UTC'))).toBe('2026-01-01T00:00:00.000Z');
    expect(iso(instanteDeHoraLocal(data(1, 1, 2026), 1439, 'UTC'))).toBe('2026-01-01T23:59:00.000Z');
    expect(iso(instanteDeHoraLocal(data(1, 1, 2026), 0, 'Asia/Kolkata'))).toBe('2025-12-31T18:30:00.000Z');
  });

  it('vários dias inteiros contam datas de calendário', () => {
    const r = intervaloDeDiasInteiros(data(24, 12, 2026), data(26, 12, 2026), SP);
    expect([iso(r.inicio), iso(r.fim)]).toEqual(['2026-12-24T03:00:00.000Z', '2026-12-27T03:00:00.000Z']);
    expect(() => intervaloDeDiasInteiros(data(26, 12, 2026), data(25, 12, 2026), SP)).toThrow(RangeError);
  });

  it('data inválida ou minutos fora de 0..1439 → RangeError', () => {
    expect(() => instanteDeHoraLocal(data(31, 2, 2026), 0, SP)).toThrow(RangeError);
    for (const m of [1440, -1, 1.5, Number.NaN]) {
      expect(() => instanteDeHoraLocal(data(1, 1, 2026), m, SP)).toThrow(RangeError);
    }
    expect(() => intervaloDeDiasInteiros(data(30, 2, 2026), data(1, 3, 2026), SP)).toThrow(RangeError);
  });
});

describe('R-1: ida e volta com partesLocais', () => {
  it.each([SP, NY, MANAUS, 'UTC', 'Asia/Kolkata'])('%s: partesLocais(instanteDeHoraLocal(d, m)) = (d, m) para horas válidas', (fuso) => {
    const dias = [data(1, 1, 2026), data(25, 12, 2026), data(29, 2, 2028), data(15, 7, 2026)];
    for (const d of dias) {
      for (const m of [0, 1, 59, 600, 725, 1439]) {
        expect(partesLocais(instanteDeHoraLocal(d, m, fuso), fuso)).toEqual({ data: d, minutosDoDia: m });
      }
    }
  });

  it('partesLocais com instante inválido ou fuso inválido → RangeError', () => {
    expect(() => partesLocais(new Date('x'), SP)).toThrow(RangeError);
    expect(() => partesLocais('2026' as unknown as Date, SP)).toThrow(RangeError);
    expect(() => partesLocais(new Date(), 'Foo/Bar')).toThrow(RangeError);
  });

  it('partesLocais à meia-noite local e antes de 1970', () => {
    expect(partesLocais(new Date('2026-12-25T03:00:00Z'), SP)).toEqual({ data: data(25, 12, 2026), minutosDoDia: 0 });
    expect(partesLocais(new Date('1965-06-01T15:30:00Z'), 'UTC')).toEqual({ data: data(1, 6, 1965), minutosDoDia: 930 });
  });
});

describe('aritmética de datas civis', () => {
  it('ehDataCivilValida: bissexto, 31/02, limites e não inteiros', () => {
    expect(ehDataCivilValida(data(29, 2, 2028))).toBe(true);
    expect(ehDataCivilValida(data(29, 2, 2027))).toBe(false);
    expect(ehDataCivilValida(data(31, 2, 2026))).toBe(false);
    expect(ehDataCivilValida(data(31, 12, 2026))).toBe(true);
    expect(ehDataCivilValida(data(0, 1, 2026))).toBe(false);
    expect(ehDataCivilValida(data(1, 13, 2026))).toBe(false);
    expect(ehDataCivilValida(data(1, 0, 2026))).toBe(false);
    expect(ehDataCivilValida(data(1, 1, 1899))).toBe(false);
    expect(ehDataCivilValida(data(1, 1, 3000))).toBe(false);
    expect(ehDataCivilValida(data(1.5, 1, 2026))).toBe(false);
    expect(ehDataCivilValida(null as never)).toBe(false);
  });

  it('somarDias: virada de mês, de ano, bissexto e negativo', () => {
    expect(somarDias(data(31, 12, 2026), 1)).toEqual(data(1, 1, 2027));
    expect(somarDias(data(28, 2, 2028), 1)).toEqual(data(29, 2, 2028));
    expect(somarDias(data(28, 2, 2027), 1)).toEqual(data(1, 3, 2027));
    expect(somarDias(data(1, 3, 2026), -1)).toEqual(data(28, 2, 2026));
    expect(somarDias(data(1, 1, 2026), 365)).toEqual(data(1, 1, 2027));
    expect(() => somarDias(data(1, 1, 2026), 0.5)).toThrow(RangeError);
    expect(() => somarDias(data(31, 2, 2026), 1)).toThrow(RangeError);
  });

  it('diferencaEmDias e compararDatas', () => {
    expect(diferencaEmDias(data(1, 1, 2026), data(1, 1, 2027))).toBe(365);
    expect(diferencaEmDias(data(1, 1, 2028), data(1, 1, 2029))).toBe(366);
    expect(diferencaEmDias(data(2, 1, 2026), data(1, 1, 2026))).toBe(-1);
    expect(compararDatas(data(1, 1, 2026), data(2, 1, 2026))).toBe(-1);
    expect(compararDatas(data(2, 1, 2026), data(2, 1, 2026))).toBe(0);
    expect(compararDatas(data(1, 2, 2026), data(31, 1, 2026))).toBe(1);
  });
});

describe('ehDiaInteiro (D-23)', () => {
  it('verdadeiro para os intervalos de dia inteiro, inclusive nos dias de 23 h e 25 h', () => {
    for (const [d1, d2] of [
      [data(25, 12, 2026), data(25, 12, 2026)],
      [data(4, 11, 2018), data(4, 11, 2018)],
      [data(17, 2, 2018), data(17, 2, 2018)],
      [data(24, 12, 2026), data(2, 1, 2027)],
    ] as const) {
      const r = intervaloDeDiasInteiros(d1, d2, SP);
      expect(ehDiaInteiro(r.inicio, r.fim, SP)).toBe(true);
    }
  });

  it('falso com 00:05, com horário comum e com meia-noite de outro fuso', () => {
    expect(ehDiaInteiro(new Date('2026-12-25T03:05:00Z'), new Date('2026-12-26T03:00:00Z'), SP)).toBe(false);
    expect(ehDiaInteiro(new Date('2026-12-25T03:00:00Z'), new Date('2026-12-25T19:00:00Z'), SP)).toBe(false);
    expect(ehDiaInteiro(new Date('2026-12-25T03:00:00Z'), new Date('2026-12-26T03:00:00Z'), MANAUS)).toBe(false);
  });
});
