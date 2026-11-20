import { describe, expect, it } from 'vitest';

import { MENSAGENS_INTERVALO } from './tipos';
import type { LinhaEntrada } from './tipos';
import { converterHorario, FORMULARIO_INVALIDO, validarDias } from './validacao';

// D-020 T-1: núcleo da semana (CA-3 reaplicado sobre validarDias, sem profissionalId).

const M = MENSAGENS_INTERVALO;
type Linha = [string, string] | LinhaEntrada;

function dias(d: Partial<Record<number, Linha[]>> = {}) {
  return [0, 1, 2, 3, 4, 5, 6].map((diaSemana) => ({
    diaSemana,
    intervalos: (d[diaSemana] ?? []).map((l) => (Array.isArray(l) ? { inicio: l[0], fim: l[1] } : l)),
  }));
}

function erros(e: unknown) {
  const r = validarDias(e);
  if (r.ok) throw new Error('esperava inválido');
  return r.erros;
}

function intervalos(e: unknown) {
  const r = validarDias(e);
  if (!r.ok) throw new Error(`esperava válido: ${JSON.stringify(r.erros)}`);
  return r.intervalos;
}

describe('converterHorario', () => {
  it('H:MM e HH:MM; 24:00 só como valor; passo de 5', () => {
    expect(converterHorario('9:00')).toEqual({ ok: true, min: 540 });
    expect(converterHorario('24:00')).toEqual({ ok: true, min: 1440 });
    expect(converterHorario('24:05')).toEqual({ ok: false, erro: 'formato' });
    expect(converterHorario('09:07')).toEqual({ ok: false, erro: 'granularidade' });
    expect(converterHorario('x'.repeat(11))).toEqual({ ok: false, erro: 'formato' });
    expect(converterHorario(540)).toEqual({ ok: false, erro: 'formato' });
  });
});

describe('validarDias: forma', () => {
  it('semana vazia é válida (todos os dias sem intervalos)', () => {
    expect(validarDias(dias())).toEqual({ ok: true, intervalos: [] });
  });

  it.each([
    ['não array', { dias: [] }],
    ['undefined', undefined],
    ['6 dias', dias().slice(0, 6)],
    ['dia repetido', dias().map((d) => (d.diaSemana === 6 ? { ...d, diaSemana: 5 } : d))],
    ['campo extra no dia', dias().map((d) => ({ ...d, profissionalId: 'x' }))],
    ['mais de 20 linhas', dias({ 1: Array.from({ length: 21 }, () => ['', ''] as [string, string]) })],
  ])('%s → formulario', (_n, e) => {
    expect(validarDias(e)).toBe(FORMULARIO_INVALIDO);
    expect(erros(e)).toEqual({ formulario: M.formulario });
  });
});

describe('validarDias: regras (CA-3)', () => {
  it('sobreposição (segunda 09:00–12:00 e 11:00–14:00) marca as duas linhas', () => {
    expect(erros(dias({ 1: [['09:00', '12:00'], ['11:00', '14:00']] }))).toEqual({
      dias: { 1: { intervalos: { 0: { intervalo: M.sobreposicao }, 1: { intervalo: M.sobreposicao } } } },
    });
  });

  it('09:07 → granularidade; 22:00–02:00 e fim = início → ordem; início 24:00 → inicio24', () => {
    expect(erros(dias({ 1: [['09:07', '12:00']], 2: [['22:00', '02:00']], 3: [['10:00', '10:00']], 4: [['24:00', '24:00']] }))).toEqual({
      dias: {
        1: { intervalos: { 0: { inicio: M.granularidade } } },
        2: { intervalos: { 0: { intervalo: M.ordem } } },
        3: { intervalos: { 0: { intervalo: M.ordem } } },
        4: { intervalos: { 0: { inicio: M.inicio24 } } },
      },
    });
  });

  it('7 intervalos num dia → limite; 6 aceitos', () => {
    const seis: [string, string][] = [8, 10, 12, 14, 16, 18].map((h) => [`${h}:00`, `${h}:30`]);
    expect(intervalos(dias({ 4: seis }))).toHaveLength(6);
    expect(erros(dias({ 4: [...seis, ['20:00', '20:30']] }))).toEqual({ dias: { 4: { dia: M.limite } } });
  });

  it('faltas de início/fim', () => {
    expect(erros(dias({ 1: [['09:00', ''], ['', '12:00']] }))).toEqual({
      dias: { 1: { intervalos: { 0: { fim: M.faltaFim }, 1: { inicio: M.faltaInicio } } } },
    });
  });

  it('terça 09:00–12:00 e 12:00–13:00 → uma linha (2, 540, 780); 22:00–24:00 → (1320, 1440)', () => {
    expect(intervalos(dias({ 2: [['09:00', '12:00'], ['12:00', '13:00']], 5: [['22:00', '24:00']] }))).toEqual([
      { diaSemana: 2, inicioMin: 540, fimMin: 780 },
      { diaSemana: 5, inicioMin: 1320, fimMin: 1440 },
    ]);
  });

  it('linhas vazias ignoradas e todos os erros juntos', () => {
    expect(intervalos(dias({ 1: [['', ''], {}, ['09:00', '10:00']] }))).toEqual([{ diaSemana: 1, inicioMin: 540, fimMin: 600 }]);
    const e = erros(dias({ 1: [['09:00', '12:00']], 3: [['22:00', '02:00']], 5: [['09:07', '10:00']] }));
    expect(Object.keys(e.dias!).sort()).toEqual(['3', '5']);
  });
});
