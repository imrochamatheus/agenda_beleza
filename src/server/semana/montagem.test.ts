import { describe, expect, it } from 'vitest';

import { diferenca, montarSemana, pausasDe } from './montagem';

// D-020 T-1: montagem, pausas e diferença do núcleo da semana.

describe('pausasDe', () => {
  it('lacunas > 0 entre consecutivos; contíguos não geram pausa', () => {
    expect(pausasDe([{ inicioMin: 780, fimMin: 1080 }, { inicioMin: 540, fimMin: 720 }])).toEqual([{ inicioMin: 720, fimMin: 780 }]);
    expect(pausasDe([{ inicioMin: 0, fimMin: 60 }, { inicioMin: 60, fimMin: 120 }])).toEqual([]);
  });
});

describe('montarSemana', () => {
  it('7 dias, índice = diaSemana, intervalos ordenados e pausas', () => {
    const s = montarSemana([
      { diaSemana: 1, inicioMin: 780, fimMin: 1080 },
      { diaSemana: 1, inicioMin: 540, fimMin: 720 },
    ]);
    expect(s.map((d) => d.diaSemana)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(s[1].intervalos).toEqual([{ inicioMin: 540, fimMin: 720 }, { inicioMin: 780, fimMin: 1080 }]);
    expect(s[1].pausas).toEqual([{ inicioMin: 720, fimMin: 780 }]);
    expect(s[0]).toEqual({ diaSemana: 0, intervalos: [], pausas: [] });
  });

  it('dia fora de 0..6 → RangeError', () => {
    expect(() => montarSemana([{ diaSemana: -1, inicioMin: 0, fimMin: 60 }])).toThrow(RangeError);
  });
});

describe('diferenca', () => {
  const existentes = [
    { id: 'a', diaSemana: 1, inicioMin: 540, fimMin: 720 },
    { id: 'b', diaSemana: 2, inicioMin: 540, fimMin: 720 },
  ];
  it('igual → nada; parcial → remove e insere só o que mudou', () => {
    expect(diferenca(existentes, existentes.map((l) => ({ diaSemana: l.diaSemana, inicioMin: l.inicioMin, fimMin: l.fimMin })))).toEqual({ remover: [], inserir: [] });
    expect(diferenca(existentes, [{ diaSemana: 1, inicioMin: 540, fimMin: 720 }, { diaSemana: 3, inicioMin: 600, fimMin: 960 }])).toEqual({
      remover: ['b'],
      inserir: [{ diaSemana: 3, inicioMin: 600, fimMin: 960 }],
    });
    expect(diferenca(existentes, [])).toEqual({ remover: ['a', 'b'], inserir: [] });
  });
});
