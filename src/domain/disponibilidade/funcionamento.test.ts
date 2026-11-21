import { describe, expect, it } from 'vitest';

import { janelasDoDia, validarFuncionamento } from './funcionamento';
import type { FuncionamentoDeAgenda, IntervaloMin } from './tipos';

const i = (inicioMin: number, fimMin: number): IntervaloMin => ({ inicioMin, fimMin });
const sete = (extra: IntervaloMin[] = []): IntervaloMin[][] => [[], [], [], [], [], [], extra];

describe('janelasDoDia', () => {
  it('não informado (null) devolve a jornada, sem alterá-la', () => {
    const j = [i(540, 720), i(780, 1080)];
    const r = janelasDoDia(j, null);
    expect(r).toEqual(j);
    expect(r).not.toBe(j);
  });

  it('dia fechado ([]) → []', () => {
    expect(janelasDoDia([i(540, 720)], [])).toEqual([]);
    expect(janelasDoDia([], [i(540, 720)])).toEqual([]);
  });

  it('interseção par a par, com vários intervalos de cada lado', () => {
    expect(janelasDoDia([i(480, 600), i(660, 900)], [i(540, 720), i(780, 1200)])).toEqual([
      i(540, 600),
      i(660, 720),
      i(780, 900),
    ]);
  });

  it('um intervalo de um lado cobre vários do outro', () => {
    expect(janelasDoDia([i(480, 1200)], [i(540, 660), i(720, 840), i(900, 1140)])).toEqual([i(540, 660), i(720, 840), i(900, 1140)]);
    expect(janelasDoDia([i(540, 660), i(720, 840)], [i(480, 1200)])).toEqual([i(540, 660), i(720, 840)]);
  });

  it('bordas encostadas não geram janela vazia', () => {
    expect(janelasDoDia([i(540, 600)], [i(600, 660)])).toEqual([]);
    expect(janelasDoDia([i(600, 660)], [i(540, 600)])).toEqual([]);
  });

  it('1440 é fim válido', () => {
    expect(janelasDoDia([i(1200, 1440)], [i(1320, 1440)])).toEqual([i(1320, 1440)]);
  });

  it('intervalos idênticos', () => {
    expect(janelasDoDia([i(540, 720)], [i(540, 720)])).toEqual([i(540, 720)]);
  });
});

describe('validarFuncionamento', () => {
  it('aceita não informado e sete dias bem formados (inclusive todos fechados e 24:00)', () => {
    expect(() => validarFuncionamento({ definido: false })).not.toThrow();
    expect(() => validarFuncionamento({ definido: true, dias: sete() })).not.toThrow();
    expect(() => validarFuncionamento({ definido: true, dias: sete([i(0, 1440)]) })).not.toThrow();
  });

  it('recusa forma inválida com RangeError', () => {
    const ruins: unknown[] = [
      null,
      { definido: 'sim' },
      { definido: true },
      { definido: true, dias: sete().slice(1) },
      { definido: true, dias: [...sete().slice(1), 'x'] },
      { definido: true, dias: sete([i(60, 60)]) },
      { definido: true, dias: sete([i(-1, 60)]) },
      { definido: true, dias: sete([i(0, 1441)]) },
      { definido: true, dias: sete([i(0.5, 60)]) },
      { definido: true, dias: sete([i(120, 60)]) },
    ];
    for (const r of ruins) expect(() => validarFuncionamento(r as FuncionamentoDeAgenda)).toThrow(RangeError);
  });
});
