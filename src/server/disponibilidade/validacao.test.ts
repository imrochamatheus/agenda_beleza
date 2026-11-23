import { describe, expect, it } from 'vitest';

import { validarCalculo, validarEntradaEstrutural, validarEscolhidos, validarPeriodo, validarServicos } from './validacao';

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

describe('validarEscolhidos (D-050)', () => {
  const t = new Date('2026-12-01T12:00:00Z');
  it('ausente, vazio ou um por serviço pedido → null', () => {
    expect(validarEscolhidos(['a', 'b'], undefined)).toBeNull();
    expect(validarEscolhidos(['a', 'b'], [])).toBeNull();
    expect(validarEscolhidos(['a', 'b'], [{ servicoId: 'a', profissionalId: 'p', inicio: t }, { servicoId: 'b', profissionalId: 'x', inicio: t }])).toBeNull();
  });
  it('serviço fora da lista, repetido, início inválido, profissional não texto ou item não objeto', () => {
    const inv = 'escolhidos_invalidos';
    expect(validarEscolhidos(['a'], [{ servicoId: 'z', profissionalId: 'p', inicio: t }])).toBe(inv);
    expect(validarEscolhidos(['a', 'b'], [{ servicoId: 'a', profissionalId: 'p', inicio: t }, { servicoId: 'a', profissionalId: 'q', inicio: t }])).toBe(inv);
    expect(validarEscolhidos(['a'], [{ servicoId: 'a', profissionalId: 'p', inicio: new Date(NaN) }])).toBe(inv);
    expect(validarEscolhidos(['a'], [{ servicoId: 'a', profissionalId: 'p', inicio: '2026-12-01' as unknown as Date }])).toBe(inv);
    expect(validarEscolhidos(['a'], [{ servicoId: 'a', profissionalId: 1 as unknown as string, inicio: t }])).toBe(inv);
    expect(validarEscolhidos(['a'], [null as unknown as { servicoId: string; profissionalId: string; inicio: Date }])).toBe(inv);
    expect(validarEscolhidos(['a'], 'x' as unknown as [])).toBe(inv);
  });
});

describe('validarCalculo (D-050)', () => {
  it('padrões e subconjuntos válidos', () => {
    expect(validarCalculo(['a', 'b'], undefined, undefined)).toBeNull();
    expect(validarCalculo(['a', 'b'], ['b'], undefined)).toBeNull();
    expect(validarCalculo(['a', 'b'], undefined, {})).toBeNull();
    expect(validarCalculo(['a', 'b'], undefined, { a: 'p', b: 'q' })).toBeNull();
    expect(validarCalculo(['a', 'b'], ['a'], { a: 'p' })).toBeNull();
  });
  it('calcular vazio ou fora da lista; restrição com chave estranha, valor não texto ou sem cobrir o cálculo', () => {
    const inv = 'calculo_invalido';
    expect(validarCalculo(['a'], [], undefined)).toBe(inv);
    expect(validarCalculo(['a'], ['z'], undefined)).toBe(inv);
    expect(validarCalculo(['a'], 'a' as unknown as string[], undefined)).toBe(inv);
    expect(validarCalculo(['a', 'b'], undefined, { a: 'p' })).toBe(inv);
    expect(validarCalculo(['a', 'b'], ['a'], { b: 'p' })).toBe(inv);
    expect(validarCalculo(['a'], undefined, { a: 'p', z: 'q' })).toBe(inv);
    expect(validarCalculo(['a'], undefined, { a: 1 as unknown as string })).toBe(inv);
    expect(validarCalculo(['a'], undefined, null as unknown as Record<string, string>)).toBe(inv);
  });
});
