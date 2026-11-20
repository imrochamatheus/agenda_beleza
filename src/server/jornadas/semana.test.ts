import { describe, expect, it } from 'vitest';

import { diferenca, montarSemana, pausasDe } from './semana';

// D-015 T-1: montagem da semana (CA-1, CA-15), pausas e diferença (D-13).

describe('pausasDe', () => {
  it('lacunas > 0 entre consecutivos, em ordem de início', () => {
    expect(pausasDe([{ inicioMin: 780, fimMin: 1080 }, { inicioMin: 540, fimMin: 720 }])).toEqual([
      { inicioMin: 720, fimMin: 780 },
    ]);
    expect(pausasDe([])).toEqual([]);
    expect(pausasDe([{ inicioMin: 0, fimMin: 60 }])).toEqual([]);
    // Contíguos não geram pausa de duração zero.
    expect(pausasDe([{ inicioMin: 0, fimMin: 60 }, { inicioMin: 60, fimMin: 120 }])).toEqual([]);
  });
});

describe('montarSemana', () => {
  it('sem linhas → 7 dias de folga, índice = diaSemana', () => {
    const s = montarSemana([]);
    expect(s.map((d) => d.diaSemana)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(s.every((d) => d.intervalos.length === 0 && d.pausas.length === 0)).toBe(true);
  });

  it('CA-1: segunda com a pausa 12:00–13:00; linhas fora de ordem são ordenadas', () => {
    const s = montarSemana([
      { diaSemana: 1, inicioMin: 780, fimMin: 1080 },
      { diaSemana: 1, inicioMin: 540, fimMin: 720 },
      { diaSemana: 0, inicioMin: 600, fimMin: 660 },
    ]);
    expect(s[1]).toEqual({
      diaSemana: 1,
      intervalos: [
        { inicioMin: 540, fimMin: 720 },
        { inicioMin: 780, fimMin: 1080 },
      ],
      pausas: [{ inicioMin: 720, fimMin: 780 }],
    });
    expect(s[0].intervalos).toEqual([{ inicioMin: 600, fimMin: 660 }]);
    expect(s[2].intervalos).toEqual([]);
  });

  it('dia fora de 0..6 → RangeError (o banco já o impede)', () => {
    expect(() => montarSemana([{ diaSemana: 7, inicioMin: 0, fimMin: 60 }])).toThrow(RangeError);
  });
});

describe('diferenca (D-13)', () => {
  const existentes = [
    { id: 'a', diaSemana: 1, inicioMin: 540, fimMin: 720 },
    { id: 'b', diaSemana: 1, inicioMin: 780, fimMin: 1080 },
  ];

  it('igual → nada a remover nem inserir (ids preservados)', () => {
    const desejados = existentes.map((l) => ({ diaSemana: l.diaSemana, inicioMin: l.inicioMin, fimMin: l.fimMin }));
    expect(diferenca(existentes, desejados)).toEqual({ remover: [], inserir: [] });
  });

  it('parcial: mantém o igual, remove o que saiu e insere o que entrou', () => {
    expect(
      diferenca(existentes, [
        { diaSemana: 1, inicioMin: 540, fimMin: 720 },
        { diaSemana: 1, inicioMin: 780, fimMin: 1020 },
        { diaSemana: 3, inicioMin: 600, fimMin: 960 },
      ]),
    ).toEqual({
      remover: ['b'],
      inserir: [
        { diaSemana: 1, inicioMin: 780, fimMin: 1020 },
        { diaSemana: 3, inicioMin: 600, fimMin: 960 },
      ],
    });
  });

  it('o mesmo horário em outro dia não casa', () => {
    expect(diferenca(existentes.slice(0, 1), [{ diaSemana: 2, inicioMin: 540, fimMin: 720 }])).toEqual({
      remover: ['a'],
      inserir: [{ diaSemana: 2, inicioMin: 540, fimMin: 720 }],
    });
  });

  it('semana vazia → remove tudo', () => {
    expect(diferenca(existentes, [])).toEqual({ remover: ['a', 'b'], inserir: [] });
  });
});
