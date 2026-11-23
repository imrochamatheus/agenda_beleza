import { describe, expect, it } from 'vitest';

import { calcularDisponibilidade } from './calcular';
import { DIA, REGRAS_SP, entrada, faixa, inicios, intervalo, jornada, prof, sp } from './apoio';

// D-050 (RN-8, RN-9, RN-10, CA-4): itens já escolhidos da mesma reserva entram no domínio puro como
// ocupações extras do profissional ([inicio, fim + intervalo), somadas pelo chamador) e como ocupações
// da cliente ([inicio, fim), para todos os profissionais).

const J = (...f: [string, string][]) => jornada(2, ...f);
const REGRAS = { ...REGRAS_SP, gradeMin: 5, intervaloMin: 10 };

describe('CA-4: A escolhido com P1 às 09:00–10:00, intervalo 10 min; horários de B (40 min)', () => {
  const r = calcularDisponibilidade(
    entrada({
      regras: REGRAS,
      duracaoMin: 40,
      ocupacoesDaCliente: [intervalo(sp(DIA, '09:00'), sp(DIA, '10:00'))],
      profissionais: [
        prof('p1', J(['08:00', '12:00']), { ocupacoes: [intervalo(sp(DIA, '09:00'), sp(DIA, '10:10'))] }),
        prof('p2', J(['08:00', '12:00'])),
      ],
    }),
  );
  const p1 = inicios(r, 0);
  const p2 = inicios(r, 1);

  it('nenhum profissional recebe início em (08:20, 10:00) (sobreposição com a cliente)', () => {
    for (const h of faixa('08:25', '09:55', 5)) {
      expect(p1).not.toContain(h);
      expect(p2).not.toContain(h);
    }
  });

  it('P1 não recebe início em (08:10, 10:10) (ocupação [t, t + 50) × [09:00, 10:10))', () => {
    for (const h of faixa('08:15', '10:05', 5)) expect(p1).not.toContain(h);
    expect(p1).toContain('08:10');
    expect(p1).toContain('10:10');
  });

  it('08:20 e 10:00 são oferecidos aos demais (adjacência à cliente é permitida)', () => {
    expect(p2).toContain('08:20');
    expect(p2).toContain('10:00');
    expect(p2).toEqual([...faixa('08:00', '08:20', 5), ...faixa('10:00', '11:20', 5)]);
  });
});

describe('ocupacoesDaCliente', () => {
  it('ausente ou vazia dá o mesmo resultado (compatível com a D-018)', () => {
    const base = entrada({ profissionais: [prof('a', J(['09:00', '12:00']))] });
    const semCampo = calcularDisponibilidade(base);
    expect(calcularDisponibilidade({ ...base, ocupacoesDaCliente: [] })).toEqual(semCampo);
    expect(inicios(semCampo)).toEqual(faixa('09:00', '11:00'));
  });

  it('não soma o intervalo do salão: só [t, t + duração) é comparado', () => {
    const r = calcularDisponibilidade(
      entrada({
        regras: { ...REGRAS_SP, intervaloMin: 30 },
        duracaoMin: 30,
        ocupacoesDaCliente: [intervalo(sp(DIA, '10:00'), sp(DIA, '10:30'))],
        profissionais: [prof('a', J(['09:00', '12:00']))],
      }),
    );
    // 09:30–10:00 encosta no item da cliente: aceito; 10:30 também.
    expect(inicios(r)).toEqual([...faixa('09:00', '09:30'), ...faixa('10:30', '11:30')]);
  });

  it('várias ocupações, fora de ordem e sobrepostas, são unidas', () => {
    const r = calcularDisponibilidade(
      entrada({
        duracaoMin: 15,
        ocupacoesDaCliente: [
          intervalo(sp(DIA, '11:00'), sp(DIA, '11:30')),
          intervalo(sp(DIA, '09:00'), sp(DIA, '09:45')),
          intervalo(sp(DIA, '09:30'), sp(DIA, '10:00')),
        ],
        profissionais: [prof('a', J(['09:00', '12:00']))],
      }),
    );
    expect(inicios(r)).toEqual([...faixa('10:00', '10:45'), ...faixa('11:30', '11:45')]);
  });

  it('ocupação da cliente em outra data não afeta o dia calculado', () => {
    const r = calcularDisponibilidade(
      entrada({
        duracaoMin: 60,
        ocupacoesDaCliente: [intervalo(sp({ ano: 2026, mes: 12, dia: 2 }, '09:00'), sp({ ano: 2026, mes: 12, dia: 2 }, '12:00'))],
        profissionais: [prof('a', J(['09:00', '12:00']))],
      }),
    );
    expect(inicios(r)).toEqual(faixa('09:00', '11:00'));
  });

  it('instante inválido → RangeError', () => {
    expect(() =>
      calcularDisponibilidade(
        entrada({ ocupacoesDaCliente: [intervalo(new Date(NaN), sp(DIA, '10:00'))], profissionais: [prof('a', J(['09:00', '12:00']))] }),
      ),
    ).toThrow(RangeError);
    expect(() =>
      calcularDisponibilidade(
        entrada({
          ocupacoesDaCliente: [{ inicio: sp(DIA, '09:00'), fim: 'x' as unknown as Date }],
          profissionais: [prof('a', J(['09:00', '12:00']))],
        }),
      ),
    ).toThrow(RangeError);
  });
});
