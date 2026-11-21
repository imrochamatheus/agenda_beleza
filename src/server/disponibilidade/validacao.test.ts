import { describe, expect, it } from 'vitest';

import { validarEntradaEstrutural, validarPeriodo, validarServicos } from './validacao';

const D = (ano: number, mes: number, dia: number) => ({ ano, mes, dia });
const ids = (n: number) => Array.from({ length: n }, (_, i) => `s${i}`);

describe('validarServicos (CA-21)', () => {
  it('aceita de 1 a 10 serviços distintos', () => {
    expect(validarServicos(ids(1))).toBeNull();
    expect(validarServicos(ids(10))).toBeNull();
  });
  it('lista vazia, repetida ou com 11 itens', () => {
    expect(validarServicos([])).toBe('servicos_vazio');
    expect(validarServicos(['a', 'b', 'a'])).toBe('servicos_repetidos');
    expect(validarServicos(ids(11))).toBe('servicos_demais');
    expect(validarServicos(undefined as unknown as string[])).toBe('servicos_vazio');
  });
});

describe('validarPeriodo (CA-21)', () => {
  it('aceita uma data e um período', () => {
    expect(validarPeriodo(D(2026, 12, 1), D(2026, 12, 1))).toBeNull();
    expect(validarPeriodo(D(2026, 12, 1), D(2027, 1, 30))).toBeNull();
  });
  it('data inexistente (31/02), mês 13 e valores não inteiros', () => {
    expect(validarPeriodo(D(2026, 2, 31), D(2026, 3, 1))).toBe('data_invalida');
    expect(validarPeriodo(D(2026, 12, 1), D(2026, 13, 1))).toBe('data_invalida');
    expect(validarPeriodo(D(2026, 12, 1.5), D(2026, 12, 2))).toBe('data_invalida');
  });
  it('ate < de', () => {
    expect(validarPeriodo(D(2026, 12, 2), D(2026, 12, 1))).toBe('periodo_invertido');
  });
});

describe('validarEntradaEstrutural', () => {
  it('serviços têm precedência sobre as datas', () => {
    expect(validarEntradaEstrutural({ servicoIds: [], de: D(2026, 2, 31), ate: D(2026, 2, 31) })).toBe('servicos_vazio');
    expect(validarEntradaEstrutural({ servicoIds: ['a'], de: D(2026, 2, 31), ate: D(2026, 2, 31) })).toBe('data_invalida');
    expect(validarEntradaEstrutural({ servicoIds: ['a'], de: D(2026, 12, 1), ate: D(2026, 12, 1) })).toBeNull();
  });
});
