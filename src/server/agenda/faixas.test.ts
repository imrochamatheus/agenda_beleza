import { describe, expect, it } from 'vitest';

import { montarSemana } from '@/server/semana/montagem';

import {
  complemento,
  diaInteiroFechado,
  distribuirLadoALado,
  foraDaJornada,
  foraDoFuncionamento,
  recortarNoDia,
  subtrair,
} from './faixas';

// D-028 T-1 (CA-7, CA-8, CA-13): faixas de fundo, recorte ao dia e lado a lado.
const H = (h: number) => h * 60;
const semana = (faixas: [number, number][], dias = [0, 1, 2, 3, 4, 5, 6]) =>
  montarSemana(dias.flatMap((diaSemana) => faixas.map(([inicioMin, fimMin]) => ({ diaSemana, inicioMin, fimMin }))));

describe('complemento e subtrair', () => {
  it('complemento de 09-18 = 00-09 e 18-24; de nada = dia inteiro; do dia inteiro = vazio', () => {
    expect(complemento([{ inicioMin: H(9), fimMin: H(18) }])).toEqual([
      { inicioMin: 0, fimMin: H(9) },
      { inicioMin: H(18), fimMin: 1440 },
    ]);
    expect(complemento([])).toEqual([{ inicioMin: 0, fimMin: 1440 }]);
    expect(complemento([{ inicioMin: 0, fimMin: 1440 }])).toEqual([]);
  });
  it('subtrair corta, divide e remove', () => {
    const a = [{ inicioMin: 0, fimMin: 100 }];
    expect(subtrair(a, [{ inicioMin: 20, fimMin: 40 }])).toEqual([{ inicioMin: 0, fimMin: 20 }, { inicioMin: 40, fimMin: 100 }]);
    expect(subtrair(a, [{ inicioMin: 0, fimMin: 100 }])).toEqual([]);
    expect(subtrair(a, [{ inicioMin: 200, fimMin: 300 }])).toEqual(a);
    expect(subtrair(a, [{ inicioMin: 50, fimMin: 150 }])).toEqual([{ inicioMin: 0, fimMin: 50 }]);
    expect(subtrair(a, [{ inicioMin: -10, fimMin: 30 }])).toEqual([{ inicioMin: 30, fimMin: 100 }]);
  });
});

describe('foraDoFuncionamento (CA-7)', () => {
  it('definido 09-18: 00-09 e 18-24', () => {
    const f = { definido: true, semana: semana([[H(9), H(18)]]) } as const;
    expect(foraDoFuncionamento(f, 2)).toEqual([{ inicioMin: 0, fimMin: H(9) }, { inicioMin: H(18), fimMin: 1440 }]);
  });
  it('não definido não pinta nada; dia vazio com definido = dia inteiro fechado', () => {
    expect(foraDoFuncionamento({ definido: false }, 2)).toEqual([]);
    const f = { definido: true, semana: semana([[H(9), H(18)]], [1]) } as const;
    expect(diaInteiroFechado(foraDoFuncionamento(f, 0))).toBe(true);
    expect(diaInteiroFechado(foraDoFuncionamento(f, 1))).toBe(false);
  });
});

describe('foraDaJornada (CA-8)', () => {
  const jornada = semana([[H(9), H(12)], [H(14), H(18)]]);
  it('12-14 e fora de 09-18, sem funcionamento', () => {
    expect(foraDaJornada(jornada, 3, [])).toEqual([
      { inicioMin: 0, fimMin: H(9) },
      { inicioMin: H(12), fimMin: H(14) },
      { inicioMin: H(18), fimMin: 1440 },
    ]);
  });
  it('não repete o que o salão já marca como fechado', () => {
    const fechado = [{ inicioMin: 0, fimMin: H(9) }, { inicioMin: H(18), fimMin: 1440 }];
    expect(foraDaJornada(jornada, 3, fechado)).toEqual([{ inicioMin: H(12), fimMin: H(14) }]);
  });
  it('sem jornada: tudo fora da jornada', () => {
    expect(foraDaJornada(null, 3, [])).toEqual([{ inicioMin: 0, fimMin: 1440 }]);
  });
});

describe('recortarNoDia (CA-13)', () => {
  const SP = 'America/Sao_Paulo';
  const dia = (iso: string) => ({ inicio: new Date(`${iso}T03:00:00Z`), fim: new Date(new Date(`${iso}T03:00:00Z`).getTime() + 86_400_000) });
  const d1 = dia('2026-12-01');
  const d2 = dia('2026-12-02');
  const ini = new Date('2026-12-02T02:00:00Z'); // 23:00 local do dia 1
  const fim = new Date('2026-12-02T04:00:00Z'); // 01:00 local do dia 2
  it('reserva 23:00–01:00 aparece nos dois dias, recortada', () => {
    expect(recortarNoDia(ini, fim, d1, SP)).toEqual({ inicioMin: H(23), fimMin: 1440 });
    expect(recortarNoDia(ini, fim, d2, SP)).toEqual({ inicioMin: 0, fimMin: H(1) });
  });
  it('encostar na fronteira não conta; fora do dia → null', () => {
    expect(recortarNoDia(new Date('2026-12-01T20:00:00Z'), d2.inicio, d2, SP)).toBeNull();
    expect(recortarNoDia(d1.fim, new Date(d1.fim.getTime() + 3_600_000), d1, SP)).toBeNull();
  });
  it('12:00Z em São Paulo = 09:00 (CA-3)', () => {
    const r = recortarNoDia(new Date('2026-12-01T12:00:00Z'), new Date('2026-12-01T13:00:00Z'), d1, SP);
    expect(r).toEqual({ inicioMin: H(9), fimMin: H(10) });
  });
  it('hora de parede repetida (recuo): usa a duração real em vez de um fim antes do início', () => {
    const NY = 'America/New_York';
    const inicio = new Date('2026-11-01T05:30:00Z'); // 01:30 EDT
    const fimDoDia = new Date('2026-11-02T05:00:00Z');
    const r = recortarNoDia(inicio, new Date('2026-11-01T06:30:00Z'), { inicio: new Date('2026-11-01T04:00:00Z'), fim: fimDoDia }, NY);
    expect(r).toEqual({ inicioMin: 90, fimMin: 150 });
  });
  it('duração que arredonda ao mesmo minuto fica com 1 minuto visível', () => {
    const r = recortarNoDia(new Date('2026-12-01T12:00:00Z'), new Date('2026-12-01T12:00:30Z'), d1, SP);
    expect(r).toEqual({ inicioMin: H(9), fimMin: H(9) + 1 });
  });
});

describe('distribuirLadoALado (encaixes não se escondem)', () => {
  it('sem sobreposição: coluna única; sobrepostos: lado a lado; grupos independentes', () => {
    const r = distribuirLadoALado([
      { inicioMin: 600, fimMin: 660, id: 'a' },
      { inicioMin: 630, fimMin: 700, id: 'b' },
      { inicioMin: 640, fimMin: 650, id: 'c' },
      { inicioMin: 800, fimMin: 860, id: 'd' },
    ]);
    const por = Object.fromEntries(r.map((x) => [x.id, [x.coluna, x.colunas]]));
    expect(por).toEqual({ a: [0, 3], b: [1, 3], c: [2, 3], d: [0, 1] });
  });
  it('reaproveita a coluna livre e encostar não sobrepõe', () => {
    const r = distribuirLadoALado([
      { inicioMin: 0, fimMin: 60, id: 'a' },
      { inicioMin: 60, fimMin: 120, id: 'b' },
    ]);
    expect(r.map((x) => [x.coluna, x.colunas])).toEqual([[0, 1], [0, 1]]);
    expect(distribuirLadoALado([])).toEqual([]);
  });
});
