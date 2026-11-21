import { describe, expect, it } from 'vitest';

import { intersecta, unirIntervalos, unirMinutos } from './intervalos';
import type { Intervalo } from './tipos';

const iv = (a: number, b: number): Intervalo => ({ inicio: new Date(a), fim: new Date(b) });

describe('unirIntervalos', () => {
  it('ordena, une sobrepostos e encostados e descarta vazios', () => {
    expect(unirIntervalos([iv(50, 60), iv(0, 10), iv(5, 20), iv(20, 30), iv(40, 40), iv(45, 41)])).toEqual([
      { i: 0, f: 30 },
      { i: 50, f: 60 },
    ]);
  });
  it('contido em outro mantém o maior fim', () => {
    expect(unirIntervalos([iv(0, 100), iv(10, 20)])).toEqual([{ i: 0, f: 100 }]);
  });
  it('não altera a entrada', () => {
    const e = [iv(10, 20), iv(0, 5)];
    unirIntervalos(e);
    expect(e[0].inicio.getTime()).toBe(10);
  });
  it('lista vazia', () => {
    expect(unirIntervalos([])).toEqual([]);
  });
});

describe('unirMinutos', () => {
  it('ordena e une contíguos/sobrepostos, descartando vazios', () => {
    expect(
      unirMinutos([
        { inicioMin: 780, fimMin: 900 },
        { inicioMin: 540, fimMin: 600 },
        { inicioMin: 600, fimMin: 660 },
        { inicioMin: 620, fimMin: 640 },
        { inicioMin: 700, fimMin: 700 },
      ]),
    ).toEqual([
      { inicioMin: 540, fimMin: 660 },
      { inicioMin: 780, fimMin: 900 },
    ]);
  });
});

describe('intersecta (busca binária)', () => {
  const u = unirIntervalos([iv(10, 20), iv(30, 40), iv(50, 60)]);
  it('lista vazia nunca intersecta', () => {
    expect(intersecta([], 0, 100)).toBe(false);
  });
  it('encostar não intersecta (semiaberto)', () => {
    expect(intersecta(u, 0, 10)).toBe(false);
    expect(intersecta(u, 20, 30)).toBe(false);
    expect(intersecta(u, 60, 70)).toBe(false);
  });
  it('sobrepor em qualquer ponto intersecta', () => {
    expect(intersecta(u, 0, 11)).toBe(true);
    expect(intersecta(u, 19, 25)).toBe(true);
    expect(intersecta(u, 35, 36)).toBe(true);
    expect(intersecta(u, 59, 100)).toBe(true);
    expect(intersecta(u, 0, 100)).toBe(true);
  });
  it('lacunas entre intervalos', () => {
    expect(intersecta(u, 20, 30)).toBe(false);
    expect(intersecta(u, 40, 50)).toBe(false);
    expect(intersecta(u, 41, 49)).toBe(false);
  });
  it('antes do primeiro e depois do último', () => {
    expect(intersecta(u, -10, 5)).toBe(false);
    expect(intersecta(u, 100, 200)).toBe(false);
  });
});
