import { describe, expect, it } from 'vitest';

import { calcularDisponibilidade } from './calcular';
import {
  D, DIA, REGRAS_SP, entrada, faixa, funcionamentoTodosOsDias, inicios, intervalo, jornada, prof, semana, sp, todosOsDias,
} from './apoio';

const calc = (parcial: Parameters<typeof entrada>[0]) => calcularDisponibilidade(entrada(parcial));
const J = (...f: [string, string][]) => jornada(2, ...f);
const FT = (...f: [string, string][]) => funcionamentoTodosOsDias(...f);

describe('funcionamento ∩ jornada (RN-20..RN-23)', () => {
  it('CA-28: funcionamento 10:00–18:00 e jornada 09:00–19:00, 60 min → 10:00 a 17:00', () => {
    const r = calc({ funcionamento: FT(['10:00', '18:00']), profissionais: [prof('a', J(['09:00', '19:00']))] });
    expect(inicios(r)[0]).toBe('10:00');
    expect(inicios(r).at(-1)).toBe('17:00');
    expect(inicios(r)).not.toContain('17:15');
  });

  it('CA-29: dia fechado no funcionamento → lista vazia, profissional no resultado; dia adjacente aberto tem horários', () => {
    const r = calc({
      funcionamento: semana({ 3: [['09:00', '12:00']] }), // só quarta; terça fechada
      datas: [DIA, D(2026, 12, 2)],
      profissionais: [prof('a', todosOsDias('09:00', '12:00'))],
    });
    expect(r).toHaveLength(1);
    expect(inicios(r, 0, 0)).toEqual([]);
    expect(inicios(r, 0, 1)).toEqual(faixa('09:00', '11:00'));
  });

  it('CA-30: funcionamento 09–12 e 13–18, jornada 08–18, 90 min → 11:00 não, 13:00 sim, 09:00 sim, 10:30 último da manhã', () => {
    const r = calc({
      duracaoMin: 90,
      funcionamento: FT(['09:00', '12:00'], ['13:00', '18:00']),
      profissionais: [prof('a', J(['08:00', '18:00']))],
    });
    const i = inicios(r);
    expect(i).not.toContain('11:00');
    expect(i).toContain('13:00');
    expect(i[0]).toBe('09:00');
    expect(i.filter((x) => x < '12:00').at(-1)).toBe('10:30');
    expect(i.at(-1)).toBe('16:30');
  });

  it('CA-31: não informado → saída idêntica à de só jornada; linhas residuais não são do domínio', () => {
    const p = prof('a', J(['09:00', '12:00'], ['13:00', '15:00']), { bloqueios: [intervalo(sp(DIA, '10:00'), sp(DIA, '10:30'))] });
    const sem = calc({ funcionamento: { definido: false }, profissionais: [p] });
    const base = calcularDisponibilidade({ ...entrada({ profissionais: [p] }), funcionamento: { definido: false } });
    expect(sem).toEqual(base);
    expect(inicios(sem).length).toBeGreaterThan(0);
  });

  it('CA-32/CA-44: 7 dias fechados (informado) → nada para ninguém, sem confundir com não informado', () => {
    const r = calc({
      funcionamento: semana({}),
      datas: [DIA, D(2026, 12, 2), D(2026, 12, 3)],
      profissionais: [prof('a', todosOsDias('00:00', '24:00')), prof('b', todosOsDias('09:00', '12:00'))],
    });
    for (const x of r) for (const d of x.dias) expect(d.horarios).toEqual([]);
    expect(r.map((x) => x.profissionalId)).toEqual(['a', 'b']);
  });

  it('CA-33: jornada com pausa e funcionamento contínuo, e o contrário, dão o mesmo resultado', () => {
    const a = calc({
      duracaoMin: 90,
      funcionamento: FT(['09:00', '18:00']),
      profissionais: [prof('a', J(['09:00', '12:00'], ['13:00', '18:00']))],
    });
    const b = calc({
      duracaoMin: 90,
      funcionamento: FT(['09:00', '12:00'], ['13:00', '18:00']),
      profissionais: [prof('a', J(['09:00', '18:00']))],
    });
    expect(inicios(a)).not.toContain('11:00');
    expect(inicios(a)).toContain('13:00');
    expect(inicios(b)).toEqual(inicios(a));
  });

  it('CA-34: vários intervalos de funcionamento; sem jornada correspondente não gera horário', () => {
    const r = calc({
      funcionamento: FT(['09:00', '11:00'], ['12:00', '14:00'], ['15:00', '19:00']),
      profissionais: [prof('a', J(['08:00', '20:00'])), prof('b', J(['08:00', '10:00']))],
    });
    expect(inicios(r)).toEqual([...faixa('09:00', '10:00'), ...faixa('12:00', '13:00'), ...faixa('15:00', '18:00')]);
    expect(inicios(r, 1)).toEqual(['09:00']);
    const so = calc({ funcionamento: FT(['15:00', '19:00']), profissionais: [prof('b', J(['08:00', '10:00']))] });
    expect(inicios(so)).toEqual([]);
  });

  it('CA-35: funcionamento até 24:00 em D e desde 00:00 em D+1 não une os dias', () => {
    const r = calc({
      funcionamento: semana({ 2: [['18:00', '24:00']], 3: [['00:00', '02:00']] }),
      datas: [DIA, D(2026, 12, 2)],
      profissionais: [prof('a', jornada(2, ['18:00', '24:00']))],
    });
    expect(inicios(r, 0, 0).at(-1)).toBe('23:00');
    expect(inicios(r, 0, 0)).not.toContain('23:15');
    const ultimo = r[0].dias[0].horarios.at(-1)!;
    expect(ultimo.fim.getTime()).toBe(sp(D(2026, 12, 2), '00:00').getTime());
    expect(inicios(r, 0, 1)).toEqual([]);
  });

  it('CA-37: jornada 09:00–12:00 e funcionamento 09:05–11:00, grade 15, 30 min → 09:15 a 10:30', () => {
    const r = calc({ duracaoMin: 30, funcionamento: FT(['09:05', '11:00']), profissionais: [prof('a', J(['09:00', '12:00']))] });
    expect(inicios(r)[0]).toBe('09:15');
    expect(inicios(r).at(-1)).toBe('10:30');
  });

  it('CA-38: bloqueio/reserva dentro do funcionamento aplicam-se; fora dele não afetam, e o intervalo de um encaixe invade', () => {
    const f = FT(['09:00', '18:00']);
    const comBloqueio = calc({
      duracaoMin: 30,
      funcionamento: f,
      profissionais: [prof('a', J(['09:00', '12:00']), { bloqueios: [intervalo(sp(DIA, '10:00'), sp(DIA, '11:00'))] })],
    });
    const semFuncionamento = calc({
      duracaoMin: 30,
      profissionais: [prof('a', J(['09:00', '12:00']), { bloqueios: [intervalo(sp(DIA, '10:00'), sp(DIA, '11:00'))] })],
    });
    expect(inicios(comBloqueio)).toEqual(inicios(semFuncionamento));
    expect(inicios(comBloqueio)).not.toContain('10:30');

    const encaixeFora = calc({
      duracaoMin: 30,
      funcionamento: f,
      profissionais: [prof('a', J(['08:00', '12:00']), { ocupacoes: [intervalo(sp(DIA, '08:00'), sp(DIA, '09:00'))] })],
    });
    expect(inicios(encaixeFora)).toEqual(faixa('09:00', '11:30'));

    const comIntervalo = calc({
      duracaoMin: 30,
      regras: { ...REGRAS_SP, intervaloMin: 15 },
      funcionamento: f,
      profissionais: [prof('a', J(['08:00', '12:00']), { ocupacoes: [intervalo(sp(DIA, '08:30'), sp(DIA, '09:15'))] })],
    });
    expect(inicios(comIntervalo)[0]).toBe('09:15');
  });

  it('CA-42: determinismo com funcionamento e entradas embaralhadas', () => {
    const b1 = intervalo(sp(DIA, '10:00'), sp(DIA, '10:30'));
    const b2 = intervalo(sp(DIA, '13:00'), sp(DIA, '13:30'));
    const o1 = intervalo(sp(DIA, '15:00'), sp(DIA, '15:45'));
    const o2 = intervalo(sp(DIA, '11:00'), sp(DIA, '11:45'));
    const f = FT(['09:00', '12:00'], ['13:00', '18:00']);
    const a = calc({ funcionamento: f, profissionais: [prof('a', J(['08:00', '19:00']), { bloqueios: [b1, b2], ocupacoes: [o1, o2] })] });
    const b = calc({ funcionamento: f, profissionais: [prof('a', J(['08:00', '19:00']), { bloqueios: [b2, b1], ocupacoes: [o2, o1] })] });
    expect(b).toEqual(a);
  });

  it('CA-43: intervalo menor que a duração → vazio sem erro; igual → exatamente 09:00', () => {
    const p = [prof('a', J(['08:00', '12:00']))];
    expect(inicios(calc({ funcionamento: FT(['09:00', '09:30']), profissionais: p }))).toEqual([]);
    expect(inicios(calc({ funcionamento: FT(['09:00', '10:00']), profissionais: p }))).toEqual(['09:00']);
  });

  it('CA-44: janela jornada ∩ funcionamento vazia → vazio e o profissional permanece', () => {
    const r = calc({ funcionamento: FT(['09:00', '12:00']), profissionais: [prof('a', J(['13:00', '18:00']))] });
    expect(r).toHaveLength(1);
    expect(inicios(r)).toEqual([]);
  });

  it('valida a forma do funcionamento (RangeError)', () => {
    const p = [prof('a', J(['09:00', '12:00']))];
    const ruim = (f: unknown) => () => calc({ funcionamento: f as never, profissionais: p });
    expect(ruim({ definido: true, dias: [] })).toThrow(RangeError);
    expect(ruim({ definido: true, dias: [[], [], [], [], [], [], [{ inicioMin: 0, fimMin: 1441 }]] })).toThrow(RangeError);
  });
});
