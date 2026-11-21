import { afterEach, describe, expect, it, vi } from 'vitest';

import { calcularDisponibilidade } from './calcular';
import { D, DIA, entrada, intervalo, jornada, prof, sp } from './apoio';

afterEach(() => vi.useRealTimers());

const bloqueios = [intervalo(sp(DIA, '10:00'), sp(DIA, '10:30')), intervalo(sp(DIA, '14:00'), sp(DIA, '15:00')), intervalo(sp(DIA, '10:15'), sp(DIA, '11:00'))];
const ocupacoes = [intervalo(sp(DIA, '09:00'), sp(DIA, '09:30')), intervalo(sp(DIA, '16:00'), sp(DIA, '17:00')), intervalo(sp(DIA, '12:00'), sp(DIA, '12:45'))];
const montar = (b: typeof bloqueios, o: typeof ocupacoes) =>
  entrada({
    datas: [DIA, D(2026, 12, 2)],
    bloqueiosDoSalao: [intervalo(sp(DIA, '13:00'), sp(DIA, '13:30'))],
    profissionais: [prof('a', [...jornada(2, ['08:00', '18:00']), ...jornada(3, ['08:00', '18:00'])], { bloqueios: b, ocupacoes: o })],
  });

describe('determinismo (CA-24)', () => {
  it('mesma entrada duas vezes e listas embaralhadas dão a mesma saída', () => {
    const a = calcularDisponibilidade(montar(bloqueios, ocupacoes));
    expect(calcularDisponibilidade(montar(bloqueios, ocupacoes))).toEqual(a);
    expect(calcularDisponibilidade(montar([...bloqueios].reverse(), [...ocupacoes].reverse()))).toEqual(a);
    expect(calcularDisponibilidade(montar([bloqueios[1], bloqueios[2], bloqueios[0]], [ocupacoes[2], ocupacoes[0], ocupacoes[1]]))).toEqual(a);
    expect(a[0].dias[0].horarios.length).toBeGreaterThan(0);
  });

  it('o relógio do processo não altera o resultado e Date.now não é lido', () => {
    const antes = calcularDisponibilidade(montar(bloqueios, ocupacoes));
    vi.useFakeTimers({ now: new Date('2031-05-05T00:00:00Z') });
    const espiao = vi.spyOn(Date, 'now');
    const depois = calcularDisponibilidade(montar(bloqueios, ocupacoes));
    expect(depois).toEqual(antes);
    expect(espiao).not.toHaveBeenCalled();
  });
});
