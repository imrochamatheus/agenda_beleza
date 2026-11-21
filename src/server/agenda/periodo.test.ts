import { describe, expect, it } from 'vitest';

import { diaDaSemana, montarPeriodo } from './periodo';

// D-028 T-1 (RN-2, CA-13): dia/semana por calendário, domingo = 0, dias de 23/25 h.
const SP = 'America/Sao_Paulo';

describe('diaDaSemana', () => {
  it('0 = domingo', () => {
    expect(diaDaSemana({ ano: 2026, mes: 11, dia: 22 })).toBe(0);
    expect(diaDaSemana({ ano: 2026, mes: 11, dia: 21 })).toBe(6);
  });
});

describe('montarPeriodo', () => {
  it('dia: [00:00, 24:00) local em UTC (SP = UTC−3)', () => {
    const p = montarPeriodo({ ano: 2026, mes: 12, dia: 1 }, 'dia', SP);
    expect(p.dias).toHaveLength(1);
    expect(p.de.toISOString()).toBe('2026-12-01T03:00:00.000Z');
    expect(p.ate.toISOString()).toBe('2026-12-02T03:00:00.000Z');
    expect(p.anterior).toEqual({ ano: 2026, mes: 11, dia: 30 });
    expect(p.proximo).toEqual({ ano: 2026, mes: 12, dia: 2 });
  });

  it('semana: do domingo ao sábado que contêm a data, atravessando mês e ano', () => {
    const p = montarPeriodo({ ano: 2026, mes: 12, dia: 31 }, 'semana', SP);
    expect(p.dias.map((d) => d.iso)).toEqual([
      '2026-12-27', '2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02',
    ]);
    expect(p.dias.map((d) => d.diaSemana)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(p.anterior).toEqual({ ano: 2026, mes: 12, dia: 24 });
    expect(p.proximo).toEqual({ ano: 2027, mes: 1, dia: 7 });
  });

  it('domingo abre a própria semana', () => {
    expect(montarPeriodo({ ano: 2026, mes: 11, dia: 22 }, 'semana', SP).dias[0].iso).toBe('2026-11-22');
  });

  it('dia de 23 h (salto) e de 25 h (recuo) em fuso com horário de verão', () => {
    const NY = 'America/New_York';
    const salto = montarPeriodo({ ano: 2026, mes: 3, dia: 8 }, 'dia', NY);
    expect((salto.ate.getTime() - salto.de.getTime()) / 3_600_000).toBe(23);
    const recuo = montarPeriodo({ ano: 2026, mes: 11, dia: 1 }, 'dia', NY);
    expect((recuo.ate.getTime() - recuo.de.getTime()) / 3_600_000).toBe(25);
    const semana = montarPeriodo({ ano: 2026, mes: 3, dia: 8 }, 'semana', NY);
    expect(semana.dias).toHaveLength(7);
    expect(semana.ate.getTime()).toBe(semana.dias[6].fim.getTime());
  });
});
