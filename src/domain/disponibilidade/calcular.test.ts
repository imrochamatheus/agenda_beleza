import { describe, expect, it } from 'vitest';

import { calcularDisponibilidade } from './calcular';
import {
  AGORA, D, DIA, REGRAS_SP, entrada, faixa, inicios, intervalo, iso, jornada, mm, prof, sp, todosOsDias,
} from './apoio';

const calc = (parcial: Parameters<typeof entrada>[0]) => calcularDisponibilidade(entrada(parcial));
// DIA = terça (dia da semana 2); D+1 = quarta (3).
const J = (...f: [string, string][]) => jornada(2, ...f);

describe('calcularDisponibilidade: jornada, grade e duração', () => {
  it('CA-2: 09:00–12:00, 75 min, grade 15 → 8 inícios, último 10:45', () => {
    const r = calc({ duracaoMin: 75, profissionais: [prof('a', J(['09:00', '12:00']))] });
    expect(inicios(r)).toEqual(faixa('09:00', '10:45'));
    expect(inicios(r)).toHaveLength(8);
  });

  it('CA-4: pausa 12:00–13:00 → 11:30 e 12:15 não; 11:00 e 13:00 sim', () => {
    const r = calc({ profissionais: [prof('a', J(['09:00', '12:00'], ['13:00', '18:00']))] });
    const i = inicios(r);
    expect(i).not.toContain('11:30');
    expect(i).not.toContain('12:15');
    expect(i).toContain('11:00');
    expect(i).toContain('13:00');
    expect(i).toContain('17:00');
    expect(i).not.toContain('17:15');
  });

  it('CA-8: 01/12/2026 09:00 em São Paulo → 2026-12-01T12:00:00Z com partes locais', () => {
    const r = calc({ profissionais: [prof('a', J(['09:00', '12:00']))] });
    const h = r[0].dias[0].horarios[0];
    expect(h.inicio.toISOString()).toBe('2026-12-01T12:00:00.000Z');
    expect(h.fim.toISOString()).toBe('2026-12-01T13:00:00.000Z');
    expect(h.local).toEqual({ data: DIA, minutosDoDia: 540 });
  });

  it('RN-4: jornada 09:05 com grade 15 → primeiro início 09:15; grade 30 → 09:30', () => {
    const p = prof('a', J(['09:05', '12:00']));
    expect(inicios(calc({ duracaoMin: 30, profissionais: [p] }))[0]).toBe('09:15');
    expect(inicios(calc({ duracaoMin: 30, regras: { ...REGRAS_SP, gradeMin: 30 }, profissionais: [p] }))[0]).toBe('09:30');
  });

  it('duração fora da grade: 50 min com grade 15 → inícios na grade, fim em qualquer minuto', () => {
    const r = calc({ duracaoMin: 50, profissionais: [prof('a', J(['09:00', '10:00']))] });
    expect(inicios(r)).toEqual(['09:00']);
    expect(r[0].dias[0].horarios[0].fim.toISOString()).toBe('2026-12-01T12:50:00.000Z');
  });

  it('duração maior que a jornada → sem horários e sem erro', () => {
    expect(inicios(calc({ duracaoMin: 240, profissionais: [prof('a', J(['09:00', '12:00']))] }))).toEqual([]);
  });

  it('duração exatamente igual à jornada → um início', () => {
    expect(inicios(calc({ duracaoMin: 180, profissionais: [prof('a', J(['09:00', '12:00']))] }))).toEqual(['09:00']);
  });

  it('CA-22/RN-8: dia sem jornada → o profissional continua no resultado, com lista vazia', () => {
    const r = calc({ profissionais: [prof('a', jornada(3, ['09:00', '12:00']))] });
    expect(r).toHaveLength(1);
    expect(r[0].profissionalId).toBe('a');
    expect(r[0].dias).toEqual([{ data: DIA, horarios: [] }]);
  });

  it('mantém a ordem dos profissionais e das datas, e cada um usa a própria jornada', () => {
    const r = calc({
      datas: [DIA, D(2026, 12, 2)],
      profissionais: [prof('b', J(['10:00', '11:00'])), prof('a', jornada(3, ['08:00', '09:00']))],
    });
    expect(r.map((x) => x.profissionalId)).toEqual(['b', 'a']);
    expect(r[0].dias.map((d) => d.data)).toEqual([DIA, D(2026, 12, 2)]);
    expect(inicios(r, 0, 0)).toEqual(['10:00']);
    expect(inicios(r, 0, 1)).toEqual([]);
    expect(inicios(r, 1, 0)).toEqual([]);
    expect(inicios(r, 1, 1)).toEqual(['08:00']);
  });

  it('jornadas contíguas ou sobrepostas na entrada são unidas (forma canônica)', () => {
    const r = calc({ duracaoMin: 60, profissionais: [prof('a', J(['09:00', '10:00'], ['10:00', '11:00']))] });
    expect(inicios(r)).toEqual(['09:00', '09:15', '09:30', '09:45', '10:00']);
  });

  it('sem profissionais ou sem datas → resultado vazio coerente', () => {
    expect(calc({ profissionais: [] })).toEqual([]);
    expect(calc({ datas: [], profissionais: [prof('a', todosOsDias('09:00', '12:00'))] })).toEqual([{ profissionalId: 'a', dias: [] }]);
  });
});

describe('calcularDisponibilidade: bloqueios e reservas', () => {
  const p = (ex: Parameters<typeof prof>[2]) => prof('a', J(['09:00', '12:00']), ex);

  it('CA-13: bloqueio 10:00–11:00; 09:30 (encosta) e 11:00 sim; 09:45, 10:00, 10:30 não; bloqueio de outra não afeta', () => {
    const r = calc({
      duracaoMin: 30,
      profissionais: [
        p({ bloqueios: [intervalo(sp(DIA, '10:00'), sp(DIA, '11:00'))] }),
        prof('b', J(['09:00', '12:00'])),
      ],
    });
    const i = inicios(r);
    expect(i).toContain('09:30');
    expect(i).toContain('11:00');
    for (const x of ['09:45', '10:00', '10:30']) expect(i).not.toContain(x);
    expect(inicios(r, 1)).toEqual(faixa('09:00', '11:30'));
  });

  it('bloqueio do salão vale para todos', () => {
    const r = calc({
      duracaoMin: 30,
      bloqueiosDoSalao: [intervalo(sp(DIA, '09:00'), sp(DIA, '12:00'))],
      profissionais: [p({}), prof('b', J(['09:00', '12:00']))],
    });
    expect(inicios(r, 0)).toEqual([]);
    expect(inicios(r, 1)).toEqual([]);
  });

  it('bloqueios sobrepostos e de vários dias são avaliados', () => {
    const r = calc({
      duracaoMin: 30,
      profissionais: [
        p({
          bloqueios: [
            intervalo(sp(DIA, '10:00'), sp(DIA, '10:45')),
            intervalo(sp(DIA, '10:30'), sp(D(2026, 12, 3), '00:00')),
          ],
        }),
      ],
    });
    expect(inicios(r)).toEqual(faixa('09:00', '09:30'));
  });

  it('CA-3: intervalo 15 e reserva 10:00–10:30 com ocupado_ate 10:45', () => {
    const r = calc({
      duracaoMin: 30,
      regras: { ...REGRAS_SP, intervaloMin: 15 },
      profissionais: [p({ ocupacoes: [intervalo(sp(DIA, '10:00'), sp(DIA, '10:45'))] })],
    });
    const i = inicios(r);
    expect(i).not.toContain('09:30');
    expect(i).not.toContain('10:30');
    expect(i).toContain('09:15');
    expect(i).toContain('10:45');
  });

  it('CA-3: intervalo 0 e ocupado_ate 10:30 → 09:30 e 10:30 são oferecidos', () => {
    const r = calc({
      duracaoMin: 30,
      profissionais: [p({ ocupacoes: [intervalo(sp(DIA, '10:00'), sp(DIA, '10:30'))] })],
    });
    expect(inicios(r)).toContain('09:30');
    expect(inicios(r)).toContain('10:30');
    expect(inicios(r)).not.toContain('09:45');
  });

  it('CA-10: A+B (75 min) e reserva 10:30–11:00 → 09:15 sim; 09:30 e 11:00 não', () => {
    const r = calc({
      duracaoMin: 75,
      profissionais: [p({ ocupacoes: [intervalo(sp(DIA, '10:30'), sp(DIA, '11:00'))] })],
    });
    const i = inicios(r);
    expect(i).toContain('09:15');
    expect(i).not.toContain('09:30');
    expect(i).not.toContain('11:00');
    expect(i).toEqual(['09:00', '09:15']);
  });

  it('CA-14: o intervalo não precisa caber na jornada nem fora de bloqueios', () => {
    const regras = { ...REGRAS_SP, intervaloMin: 15 };
    const base = prof('a', J(['09:00', '10:00']));
    expect(inicios(calc({ regras, profissionais: [base] }))).toEqual(['09:00']);
    const comBloqueio = prof('a', J(['09:00', '10:00']), { bloqueios: [intervalo(sp(DIA, '10:00'), sp(DIA, '10:15'))] });
    expect(inicios(calc({ regras, profissionais: [comBloqueio] }))).toEqual(['09:00']);
  });

  it('ocupação que começa antes do período e termina dentro dele ocupa', () => {
    const r = calc({
      duracaoMin: 30,
      profissionais: [p({ ocupacoes: [intervalo(sp(D(2026, 11, 30), '23:00'), sp(DIA, '09:30'))] })],
    });
    expect(inicios(r)[0]).toBe('09:30');
  });

  it('intervalos vazios ou invertidos são ignorados', () => {
    const r = calc({
      duracaoMin: 30,
      profissionais: [p({ bloqueios: [intervalo(sp(DIA, '10:00'), sp(DIA, '10:00')), intervalo(sp(DIA, '11:00'), sp(DIA, '10:00'))] })],
    });
    expect(inicios(r)).toEqual(faixa('09:00', '11:30'));
  });
});

describe('calcularDisponibilidade: antecedência e janela', () => {
  const todos = prof('a', todosOsDias('08:00', '18:00'));
  const hoje = D(2026, 11, 20);

  it('CA-6: agora 08:00 local, antecedência 2 h → primeiro 10:00; com 08:07 → 10:15', () => {
    const a = calc({ agora: sp(hoje, '08:00'), datas: [hoje], profissionais: [todos] });
    expect(inicios(a)[0]).toBe('10:00');
    const b = calc({ agora: sp(hoje, '08:07'), datas: [hoje], profissionais: [todos] });
    expect(inicios(b)[0]).toBe('10:15');
  });

  it('antecedência 0: início igual a agora é válido', () => {
    const r = calc({ agora: sp(hoje, '09:00'), regras: { ...REGRAS_SP, antecedenciaMin: 0 }, datas: [hoje], profissionais: [todos] });
    expect(inicios(r)[0]).toBe('09:00');
  });

  it('CA-7: janela 60 → hoje+60 tem horários (inclusive 23:45); hoje+61 não', () => {
    const p = prof('a', todosOsDias('00:00', '24:00'));
    const d60 = D(2027, 1, 19);
    const d61 = D(2027, 1, 20);
    const r = calc({ duracaoMin: 15, datas: [d60, d61], profissionais: [p] });
    expect(inicios(r, 0, 0)).toContain('23:45');
    expect(inicios(r, 0, 1)).toEqual([]);
    expect(r[0].dias[1].data).toEqual(d61);
  });

  it('data no passado → vazia, sem erro (A-8)', () => {
    const r = calc({ datas: [D(2026, 11, 19), hoje], profissionais: [todos] });
    expect(inicios(r, 0, 0)).toEqual([]);
    expect(inicios(r, 0, 1).length).toBeGreaterThan(0);
  });

  it('janela 0: só hoje', () => {
    const r = calc({
      regras: { ...REGRAS_SP, janelaDias: 0, antecedenciaMin: 0 },
      agora: sp(hoje, '09:00'),
      datas: [hoje, D(2026, 11, 21)],
      profissionais: [todos],
    });
    expect(inicios(r, 0, 0).length).toBeGreaterThan(0);
    expect(inicios(r, 0, 1)).toEqual([]);
  });

  it('CA-15: agora 23:00 local de D, antecedência 2 h → D sem horários; primeiro de D+1 é 01:00', () => {
    const r = calc({
      agora: sp(DIA, '23:00'),
      datas: [DIA, D(2026, 12, 2)],
      profissionais: [prof('a', [...jornada(2, ['20:00', '24:00']), ...jornada(3, ['00:00', '04:00'])])],
    });
    expect(inicios(r, 0, 0)).toEqual([]);
    expect(inicios(r, 0, 1)[0]).toBe('01:00');
  });

  it('a data de hoje é a data LOCAL de agora (virada de dia entre UTC e local)', () => {
    // 2026-11-21T01:00Z = 20/11 22:00 em São Paulo: hoje local = 20/11.
    const r = calc({
      agora: iso('2026-11-21T01:00:00Z'),
      regras: { ...REGRAS_SP, antecedenciaMin: 0 },
      datas: [hoje, D(2026, 11, 21)],
      profissionais: [prof('a', todosOsDias('22:00', '24:00'))],
    });
    expect(inicios(r, 0, 0)[0]).toBe('22:00');
    expect(inicios(r, 0, 1)[0]).toBe('22:00');
  });
});

describe('calcularDisponibilidade: fim de jornada 24:00 e meia-noite', () => {
  it('CA-16: 22:00–24:00 em D e 00:00–02:00 em D+1 → último início 23:00; 23:15 não', () => {
    const r = calc({
      datas: [DIA, D(2026, 12, 2)],
      profissionais: [prof('a', [...jornada(2, ['22:00', '24:00']), ...jornada(3, ['00:00', '02:00'])])],
    });
    expect(inicios(r, 0, 0)).toEqual(['22:00', '22:15', '22:30', '22:45', '23:00']);
    const ultimo = r[0].dias[0].horarios.at(-1)!;
    expect(ultimo.inicio.toISOString()).toBe('2026-12-02T02:00:00.000Z');
    expect(ultimo.fim.toISOString()).toBe('2026-12-02T03:00:00.000Z');
    expect(ultimo.fim.getTime()).toBe(sp(D(2026, 12, 2), '00:00').getTime());
    expect(inicios(r, 0, 1)).toEqual(['00:00', '00:15', '00:30', '00:45', '01:00']);
  });
});

describe('calcularDisponibilidade: validação (erros de programação)', () => {
  const p = [prof('a', J(['09:00', '12:00']))];
  const lanca = (parcial: Parameters<typeof entrada>[0]) => () => calcularDisponibilidade(entrada(parcial));

  it('rejeita regras, duração e agora inválidos', () => {
    expect(lanca({ profissionais: p, agora: new Date(NaN) })).toThrow(RangeError);
    expect(lanca({ profissionais: p, regras: { ...REGRAS_SP, fuso: 'Nao/Existe' } })).toThrow(RangeError);
    expect(lanca({ profissionais: p, regras: { ...REGRAS_SP, gradeMin: 0 } })).toThrow(RangeError);
    expect(lanca({ profissionais: p, regras: { ...REGRAS_SP, gradeMin: 1441 } })).toThrow(RangeError);
    expect(lanca({ profissionais: p, regras: { ...REGRAS_SP, antecedenciaMin: -1 } })).toThrow(RangeError);
    expect(lanca({ profissionais: p, regras: { ...REGRAS_SP, janelaDias: 1.5 } })).toThrow(RangeError);
    expect(lanca({ profissionais: p, regras: { ...REGRAS_SP, intervaloMin: -5 } })).toThrow(RangeError);
    expect(lanca({ profissionais: p, duracaoMin: 0 })).toThrow(RangeError);
    expect(lanca({ profissionais: p, duracaoMin: 30.5 })).toThrow(RangeError);
  });

  it('rejeita datas inválidas, repetidas ou fora de ordem, e jornada inválida', () => {
    expect(lanca({ profissionais: p, datas: [D(2026, 2, 31)] })).toThrow(RangeError);
    expect(lanca({ profissionais: p, datas: [DIA, DIA] })).toThrow(RangeError);
    expect(lanca({ profissionais: p, datas: [D(2026, 12, 2), DIA] })).toThrow(RangeError);
    expect(lanca({ profissionais: [prof('a', [{ diaSemana: 7, inicioMin: 0, fimMin: 60 }])] })).toThrow(RangeError);
    expect(lanca({ profissionais: [prof('a', [{ diaSemana: 1, inicioMin: 60, fimMin: 60 }])] })).toThrow(RangeError);
    expect(lanca({ profissionais: [prof('a', [{ diaSemana: 1, inicioMin: 0, fimMin: 1441 }])] })).toThrow(RangeError);
    expect(lanca({ profissionais: [prof('a', [{ diaSemana: 1, inicioMin: 0.5, fimMin: 60 }])] })).toThrow(RangeError);
  });

  it('mm auxiliar e AGORA coerentes', () => {
    expect(mm('09:30')).toBe(570);
    expect(AGORA.toISOString()).toBe('2026-11-20T12:00:00.000Z');
  });
});
