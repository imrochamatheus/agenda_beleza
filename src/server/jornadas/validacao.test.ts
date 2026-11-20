import { describe, expect, it } from 'vitest';

import { formatarMinutosDoDia } from '@/lib/format';

import { MENSAGENS_JORNADA } from './tipos';
import type { LinhaEntrada } from './tipos';
import { converterHorario, validarSemana } from './validacao';

// D-015 T-1 (D-18: é o tests/unit/jornadas/intervalos.test.ts da issue, no glob do projeto unit).
// CA-2, CA-4..CA-7, CA-9 e R-5.

const ID = '5d2a9b1c-3e4f-4a5b-8c6d-7e8f9a0b1c2d';
const M = MENSAGENS_JORNADA;

type Linha = [string, string] | LinhaEntrada;

/** Semana completa (7 dias; os omitidos são folga). Índice = dia (0 = domingo). */
function semana(dias: Partial<Record<number, Linha[]>> = {}, profissionalId: unknown = ID) {
  return {
    profissionalId,
    dias: [0, 1, 2, 3, 4, 5, 6].map((d) => ({
      diaSemana: d,
      intervalos: (dias[d] ?? []).map((l) => (Array.isArray(l) ? { inicio: l[0], fim: l[1] } : l)),
    })),
  };
}

function erros(e: unknown) {
  const r = validarSemana(e);
  if (r.ok) throw new Error('esperava inválido');
  return r.erros;
}

function intervalos(e: unknown) {
  const r = validarSemana(e);
  if (!r.ok) throw new Error(`esperava válido: ${JSON.stringify(r.erros)}`);
  return r.intervalos;
}

describe('converterHorario (R-5)', () => {
  it('aceita H:MM e HH:MM, com espaços nas pontas; 00:00 e 24:00', () => {
    expect(converterHorario('00:00')).toEqual({ ok: true, min: 0 });
    expect(converterHorario('9:00')).toEqual({ ok: true, min: 540 });
    expect(converterHorario(' 09:00 ')).toEqual({ ok: true, min: 540 });
    expect(converterHorario('09:05')).toEqual({ ok: true, min: 545 });
    expect(converterHorario('23:55')).toEqual({ ok: true, min: 1435 });
    expect(converterHorario('24:00')).toEqual({ ok: true, min: 1440 });
  });

  it('formato inválido: 24:05, 25:00, 12:60, 9h, 09:00:00, vazio, texto, número, longo', () => {
    for (const v of ['24:05', '25:00', '12:60', '9h', '09:00:00', '', 'abc', '0900', '1:5', '123:00', ' '.repeat(4) + '09:00  ', undefined, 540, null]) {
      expect(converterHorario(v), String(v)).toEqual({ ok: false, erro: 'formato' });
    }
  });

  it('CA-6: minutos fora do passo de 5 → granularidade', () => {
    expect(converterHorario('09:07')).toEqual({ ok: false, erro: 'granularidade' });
    expect(converterHorario('23:59')).toEqual({ ok: false, erro: 'granularidade' });
  });

  it('ida e volta com formatarMinutosDoDia', () => {
    for (const m of [0, 5, 545, 1435, 1440]) {
      expect(converterHorario(formatarMinutosDoDia(m))).toEqual({ ok: true, min: m });
    }
  });
});

describe('validarSemana: forma da entrada (regra 1)', () => {
  it('semana toda de folga é válida (RN-8)', () => {
    expect(validarSemana(semana())).toEqual({ ok: true, profissionalId: ID, intervalos: [] });
  });

  it.each([
    ['não objeto', null],
    ['sem profissionalId', { dias: semana().dias }],
    ['profissionalId não texto', semana({}, 42)],
    ['6 dias', { profissionalId: ID, dias: semana().dias.slice(0, 6) }],
    ['8 dias', { profissionalId: ID, dias: [...semana().dias, { diaSemana: 0, intervalos: [] }] }],
    ['dia repetido', { profissionalId: ID, dias: semana().dias.map((d) => (d.diaSemana === 6 ? { ...d, diaSemana: 5 } : d)) }],
    ['dia 7', { profissionalId: ID, dias: semana().dias.map((d) => (d.diaSemana === 6 ? { ...d, diaSemana: 7 } : d)) }],
    ['dia não inteiro', { profissionalId: ID, dias: semana().dias.map((d) => (d.diaSemana === 6 ? { ...d, diaSemana: 5.5 } : d)) }],
    ['salaoId extra (CA-11)', { ...semana(), salaoId: ID }],
    ['campo extra no dia', { profissionalId: ID, dias: semana().dias.map((d) => ({ ...d, x: 1 })) }],
    ['campo extra na linha', semana({ 1: [{ inicio: '09:00', fim: '10:00', x: '1' } as LinhaEntrada] })],
    ['horário numérico', semana({ 1: [{ inicio: 540 as unknown as string, fim: '10:00' }] })],
    ['mais de 20 linhas num dia', semana({ 1: Array.from({ length: 21 }, () => ['', ''] as [string, string]) })],
  ])('%s → formulario, sem erros de campo', (_n, e) => {
    expect(erros(e)).toEqual({ formulario: M.formulario });
  });

  it('20 linhas (vazias) num dia ainda passam da forma', () => {
    expect(intervalos(semana({ 1: Array.from({ length: 20 }, () => ['', ''] as [string, string]) }))).toEqual([]);
  });

  it('dias fora de ordem são aceitos (o índice vem de diaSemana)', () => {
    const e = semana({ 3: [['10:00', '16:00']] });
    e.dias.reverse();
    expect(intervalos(e)).toEqual([{ diaSemana: 3, inicioMin: 600, fimMin: 960 }]);
  });
});

describe('validarSemana: linhas e dias (regras 2..4)', () => {
  it('CA-1: segunda 09:00–12:00 e 13:00–18:00', () => {
    expect(intervalos(semana({ 1: [['09:00', '12:00'], ['13:00', '18:00']] }))).toEqual([
      { diaSemana: 1, inicioMin: 540, fimMin: 720 },
      { diaSemana: 1, inicioMin: 780, fimMin: 1080 },
    ]);
  });

  it('CA-2: sobrepostos 09:00–12:00 e 11:00–14:00 → erro nas duas linhas', () => {
    expect(erros(semana({ 1: [['09:00', '12:00'], ['11:00', '14:00']] }))).toEqual({
      dias: { 1: { intervalos: { 0: { intervalo: M.sobreposicao }, 1: { intervalo: M.sobreposicao } } } },
    });
  });

  it('CA-2: intervalos idênticos também se sobrepõem', () => {
    expect(erros(semana({ 2: [['09:00', '10:00'], ['', ''], ['09:00', '10:00']] }))).toEqual({
      dias: { 2: { intervalos: { 0: { intervalo: M.sobreposicao }, 2: { intervalo: M.sobreposicao } } } },
    });
  });

  it('sobreposição com uma linha anterior não vizinha (o mais longo cobre os seguintes)', () => {
    const e = erros(semana({ 1: [['08:00', '18:00'], ['09:00', '10:00'], ['12:00', '13:00']] }));
    expect(Object.keys(e.dias![1]!.intervalos!).sort()).toEqual(['0', '1', '2']);
  });

  it('CA-4: 22:00–02:00 e 10:00–10:00 → ordem (sem dividir em dois dias)', () => {
    expect(erros(semana({ 5: [['22:00', '02:00']], 6: [['10:00', '10:00']] }))).toEqual({
      dias: { 5: { intervalos: { 0: { intervalo: M.ordem } } }, 6: { intervalos: { 0: { intervalo: M.ordem } } } },
    });
  });

  it('CA-5: 22:00–24:00 aceito como (1320, 1440); 00:00–02:00 aceito', () => {
    expect(intervalos(semana({ 5: [['22:00', '24:00']], 6: [['00:00', '02:00']] }))).toEqual([
      { diaSemana: 5, inicioMin: 1320, fimMin: 1440 },
      { diaSemana: 6, inicioMin: 0, fimMin: 120 },
    ]);
  });

  it('CA-5: início 24:00 → inicio24; fim 24:05 ou 25:00 → formato', () => {
    expect(erros(semana({ 1: [['24:00', '24:00'], ['22:00', '24:05'], ['22:00', '25:00']] }))).toEqual({
      dias: { 1: { intervalos: { 0: { inicio: M.inicio24 }, 1: { fim: M.formato }, 2: { fim: M.formato } } } },
    });
  });

  it('CA-6: 09:07–12:00 → granularidade; 9h, 12:60 e texto → formato', () => {
    expect(erros(semana({ 1: [['09:07', '12:00'], ['9h', '12:60'], ['abc', '13:00']] }))).toEqual({
      dias: {
        1: {
          intervalos: {
            0: { inicio: M.granularidade },
            1: { inicio: M.formato, fim: M.formato },
            2: { inicio: M.formato },
          },
        },
      },
    });
  });

  it('CA-6: só início ou só fim → erro no campo vazio (e o preenchido também é validado)', () => {
    expect(erros(semana({ 1: [['09:00', ''], ['  ', '12:00'], ['9h', '']] }))).toEqual({
      dias: {
        1: {
          intervalos: {
            0: { fim: M.faltaFim },
            1: { inicio: M.faltaInicio },
            2: { inicio: M.formato, fim: M.faltaFim },
          },
        },
      },
    });
  });

  it('linha totalmente vazia (ou só espaços, ou sem campos) é ignorada', () => {
    expect(intervalos(semana({ 1: [['', ''], [' ', '  '], {}, ['09:00', '10:00']] }))).toEqual([
      { diaSemana: 1, inicioMin: 540, fimMin: 600 },
    ]);
  });

  it('CA-7: contíguos são unidos e fora de ordem são ordenados', () => {
    expect(intervalos(semana({ 2: [['12:00', '13:00'], ['09:00', '12:00']] }))).toEqual([
      { diaSemana: 2, inicioMin: 540, fimMin: 780 },
    ]);
    expect(intervalos(semana({ 2: [['15:00', '16:00'], ['09:00', '10:00'], ['10:00', '11:00'], ['11:00', '12:00']] }))).toEqual([
      { diaSemana: 2, inicioMin: 540, fimMin: 720 },
      { diaSemana: 2, inicioMin: 900, fimMin: 960 },
    ]);
  });

  it('CA-9: 6 intervalos aceitos; 7 → limite do dia', () => {
    const seis: [string, string][] = [8, 10, 12, 14, 16, 18].map((h) => [`${h}:00`, `${h}:30`]);
    expect(intervalos(semana({ 4: seis }))).toHaveLength(6);
    const sete: [string, string][] = [...seis, ['20:00', '20:30']];
    expect(erros(semana({ 4: sete }))).toEqual({ dias: { 4: { dia: M.limite } } });
  });

  it('o limite conta linhas não vazias antes da união dos contíguos (D-16)', () => {
    const sete: [string, string][] = [8, 9, 10, 11, 12, 13, 14].map((h) => [`${h}:00`, `${h + 1}:00`]);
    expect(erros(semana({ 1: sete }))).toEqual({ dias: { 1: { dia: M.limite } } });
  });

  it('todos os erros voltam juntos e nenhum dia é aceito pela metade (RN-6)', () => {
    const e = erros(semana({ 1: [['09:00', '12:00']], 3: [['22:00', '02:00']], 5: [['09:07', '10:00']] }));
    expect(Object.keys(e.dias!).sort()).toEqual(['3', '5']);
    expect(e.formulario).toBeUndefined();
  });

  it('resultado ordenado por dia e início, com domingo (0) primeiro', () => {
    expect(intervalos(semana({ 6: [['09:00', '10:00']], 0: [['10:00', '11:00']], 1: [['13:00', '14:00'], ['08:00', '09:00']] }))).toEqual([
      { diaSemana: 0, inicioMin: 600, fimMin: 660 },
      { diaSemana: 1, inicioMin: 480, fimMin: 540 },
      { diaSemana: 1, inicioMin: 780, fimMin: 840 },
      { diaSemana: 6, inicioMin: 540, fimMin: 600 },
    ]);
  });
});
