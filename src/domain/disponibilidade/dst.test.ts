import { describe, expect, it } from 'vitest';

import { calcularDisponibilidade } from './calcular';
import { D, entrada, faixa, funcionamentoTodosOsDias, inicios, jornada, prof, rotulo } from './apoio';
import type { RegrasDeAgenda } from './tipos';

const NY: RegrasDeAgenda = { fuso: 'America/New_York', gradeMin: 15, antecedenciaMin: 120, janelaDias: 400, intervaloMin: 0 };
const AGORA_NY = new Date('2026-01-01T12:00:00Z');
// 08/03/2026 é domingo (0); 01/11/2026 é domingo (0).
const SALTO = D(2026, 3, 8);
const RECUO = D(2026, 11, 1);

const calc = (data: ReturnType<typeof D>, jornadaFaixa: [string, string], funcionamento?: [string, string]) =>
  calcularDisponibilidade(
    entrada({
      agora: AGORA_NY,
      regras: NY,
      datas: [data],
      funcionamento: funcionamento ? funcionamentoTodosOsDias(funcionamento) : { definido: false },
      profissionais: [prof('a', jornada(0, jornadaFaixa))],
    }),
  );

const utc = (r: ReturnType<typeof calc>): string[] => r[0].dias[0].horarios.map((h) => h.inicio.toISOString().slice(11, 16));

describe('horário de verão (America/New_York)', () => {
  it('CA-17: salto — 00:00 a 01:45 e 03:00, sem rótulos 02:xx', () => {
    const r = calc(SALTO, ['00:00', '04:00']);
    expect(inicios(r)).toEqual([...faixa('00:00', '01:45'), '03:00']);
    expect(utc(r)).toEqual(['05:00', '05:15', '05:30', '05:45', '06:00', '06:15', '06:30', '06:45', '07:00']);
    expect(inicios(r).some((x) => x.startsWith('02:'))).toBe(false);
    const h0145 = r[0].dias[0].horarios[7];
    expect(h0145.fim.toISOString()).toBe('2026-03-08T07:45:00.000Z');
  });

  it('CA-18: recuo — 13 inícios de 00:00 a 03:00, só a primeira ocorrência, sem duplicados', () => {
    const r = calc(RECUO, ['00:00', '04:00']);
    expect(inicios(r)).toEqual(faixa('00:00', '03:00'));
    expect(inicios(r)).toHaveLength(13);
    expect(new Set(inicios(r)).size).toBe(13);
    const h = r[0].dias[0].horarios;
    expect(h.find((x) => rotulo(x.local.minutosDoDia) === '01:00')!.inicio.toISOString()).toBe('2026-11-01T05:00:00.000Z');
    expect(h.find((x) => rotulo(x.local.minutosDoDia) === '02:00')!.inicio.toISOString()).toBe('2026-11-01T07:00:00.000Z');
    const instantes = utc(r);
    for (const x of ['06:00', '06:15', '06:30', '06:45']) expect(instantes).not.toContain(x);
    expect(new Set(instantes).size).toBe(13);
  });

  it('CA-36: salto com funcionamento igual ou 01:00–04:00', () => {
    expect(inicios(calc(SALTO, ['00:00', '04:00'], ['00:00', '04:00']))).toEqual([...faixa('00:00', '01:45'), '03:00']);
    expect(inicios(calc(SALTO, ['00:00', '04:00'], ['01:00', '04:00']))).toEqual(['01:00', '01:15', '01:30', '01:45', '03:00']);
  });

  it('CA-36: recuo com funcionamento igual ou 01:00–04:00', () => {
    expect(inicios(calc(RECUO, ['00:00', '04:00'], ['00:00', '04:00']))).toEqual(faixa('00:00', '03:00'));
    const r = calc(RECUO, ['00:00', '04:00'], ['01:00', '04:00']);
    expect(inicios(r)).toEqual(faixa('01:00', '03:00'));
    expect(new Set(inicios(r)).size).toBe(inicios(r).length);
    expect(utc(r)[0]).toBe('05:00');
  });

  it('atendimento que atravessa o salto dura o tempo real', () => {
    const r = calc(SALTO, ['00:00', '04:00']);
    const h0130 = r[0].dias[0].horarios.find((x) => rotulo(x.local.minutosDoDia) === '01:30')!;
    expect(h0130.fim.getTime() - h0130.inicio.getTime()).toBe(3_600_000);
    expect(h0130.fim.toISOString()).toBe('2026-03-08T07:30:00.000Z');
  });
});

describe('São Paulo histórico (04/11/2018, 00:00 inexistente)', () => {
  it('a hora inexistente é descartada', () => {
    const r = calcularDisponibilidade(
      entrada({
        agora: new Date('2018-01-01T12:00:00Z'),
        regras: { fuso: 'America/Sao_Paulo', gradeMin: 60, antecedenciaMin: 0, janelaDias: 400, intervaloMin: 0 },
        datas: [D(2018, 11, 4)],
        duracaoMin: 60,
        profissionais: [prof('a', jornada(0, ['00:00', '03:00']))],
      }),
    );
    expect(inicios(r)).toEqual(['01:00', '02:00']);
  });
});
