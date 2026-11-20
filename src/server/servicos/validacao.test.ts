import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { formatarMoeda, formatarMoedaSemSimbolo } from '@/lib/format';

import { LIMITES_SERVICO, MENSAGENS_SERVICO } from './tipos';
import {
  converterDuracao,
  converterPrecoParaCentavos,
  validarDadosServico,
  validarListaDeProfissionais,
} from './validacao';

// D-014 T-1: CA-5 (RN-1, D-1..D-3) na validação pura dos dados do serviço.

const M = MENSAGENS_SERVICO;
const P1 = '5d2a9b1c-3e4f-4a5b-8c6d-7e8f9a0b1c2d';
const P2 = '0b0c5f6e-4a7d-4f0a-9a43-1f7f3c1e2d10';
const valido = { nome: 'Corte', preco: '80,00', duracao: '45', profissionais: [P1] };

describe('converterPrecoParaCentavos (D-1, D-2)', () => {
  it.each([
    ['80', 8000],
    ['80,5', 8050],
    ['80,00', 8000],
    ['1.234,56', 123456],
    ['1.234', 123400],
    ['R$ 0,00', 0],
    ['R$80', 8000],
    ['R$ 80,00', 8000],
    ['R$ 80,00', 8000],
    ['0,10', 10],
    ['0', 0],
    ['007,05', 705],
    ['  99.999,99  ', 9999999],
    ['99999,99', 9999999],
  ])('aceita %j → %d', (texto, centavos) => {
    expect(converterPrecoParaCentavos(texto)).toBe(centavos);
  });

  it.each([
    '-1,00',
    'abc',
    '80,001',
    '80.00',
    '100.000,00',
    '100000',
    '',
    '   ',
    '1.23,00',
    '1,234.56',
    '80,',
    ',50',
    'R$',
    '1e3',
    '8 0',
    '0000000000000000000001',
  ])('recusa %j', (texto) => {
    expect(converterPrecoParaCentavos(texto)).toBeNull();
  });

  it.each([80, 8000, null, undefined, true, ['80'], { v: '80' }])('recusa o tipo %j (só texto)', (v) => {
    expect(converterPrecoParaCentavos(v)).toBeNull();
  });

  it('o teto do texto é precoMaxCaracteres', () => {
    expect(LIMITES_SERVICO.precoMaxCaracteres).toBe(20);
    expect(converterPrecoParaCentavos(`${'0'.repeat(16)}1,00`)).toBe(100);
    expect(converterPrecoParaCentavos(`${'0'.repeat(17)}1,00`)).toBeNull();
  });

  it.each([0, 10, 8000, 123456, 9999999])('ida e volta com formatarMoeda e formatarMoedaSemSimbolo: %d', (n) => {
    expect(converterPrecoParaCentavos(formatarMoedaSemSimbolo(n))).toBe(n);
    expect(converterPrecoParaCentavos(formatarMoeda(n))).toBe(n);
  });

  it('a conversão não usa parseFloat nem Number sobre texto decimal', () => {
    const fonte = readFileSync(fileURLToPath(new URL('./validacao.ts', import.meta.url)), 'utf8');
    expect(fonte).not.toMatch(/parseFloat\(|parseInt\(/);
    expect(fonte).not.toMatch(/Number\(\s*(v|texto)\b/);
  });
});

describe('converterDuracao', () => {
  it.each([
    ['45', 45],
    [' 45 ', 45],
    [45, 45],
    ['0', 0],
    ['9999', 9999],
  ])('%j → %d (sem verificar faixa)', (v, n) => {
    expect(converterDuracao(v)).toBe(n);
  });

  it.each(['45.5', '', '4 5', '1e2', '-5', '10000', 45.5, NaN, null, undefined, ['45']])('%j → null', (v) => {
    expect(converterDuracao(v)).toBeNull();
  });
});

describe('validarListaDeProfissionais', () => {
  it('deduplica, normaliza para minúsculas e aceita lista vazia', () => {
    expect(validarListaDeProfissionais([])).toEqual([]);
    expect(validarListaDeProfissionais([P1, P1.toUpperCase(), P2])).toEqual([P1, P2]);
  });

  it('recusa não-array, item malformado, número e mais de 200 itens', () => {
    expect(LIMITES_SERVICO.profissionaisMax).toBe(200);
    for (const v of ['abc', P1, null, undefined, {}, ['abc'], [P1, 7], [P1, null]]) {
      expect(validarListaDeProfissionais(v), JSON.stringify(v)).toBeNull();
    }
    expect(validarListaDeProfissionais(Array.from({ length: 200 }, () => P1))).toEqual([P1]);
    expect(validarListaDeProfissionais(Array.from({ length: 201 }, () => P1))).toBeNull();
  });
});

describe('validarDadosServico (CA-5)', () => {
  it('válido: nome normalizado, preço em centavos, duração em minutos, profissionais deduplicados', () => {
    expect(validarDadosServico({ ...valido, nome: '  Corte   feminino ', profissionais: [P1, P1] })).toEqual({
      ok: true,
      dados: { nome: 'Corte feminino', precoCentavos: 8000, duracaoMin: 45, profissionais: [P1] },
    });
    expect(validarDadosServico({ ...valido, duracao: 720, preco: 'R$ 0,00', profissionais: [] })).toEqual({
      ok: true,
      dados: { nome: 'Corte', precoCentavos: 0, duracaoMin: 720, profissionais: [] },
    });
  });

  it.each([0, -5, 7, 725, '45.5', '', '0', '725', 3, 721, null])('duração %j → erro de duração', (duracao) => {
    expect(validarDadosServico({ ...valido, duracao })).toEqual({ ok: false, erros: { duracao: M.duracao } });
  });

  it.each([5, 50, 715, 720, '5'])('duração %j é aceita (múltiplo de 5 em [5, 720])', (duracao) => {
    expect(validarDadosServico({ ...valido, duracao }).ok).toBe(true);
  });

  it.each(['-1,00', 'abc', '80,001', '80.00', '100.000,00', '', 80])('preço %j → erro de preço', (preco) => {
    expect(validarDadosServico({ ...valido, preco })).toEqual({ ok: false, erros: { preco: M.preco } });
  });

  it.each(['', '   ', 'A', 'a'.repeat(101), undefined, 7, 'Corte\nfeminino'])('nome %j → erro de nome', (nome) => {
    expect(validarDadosServico({ ...valido, nome })).toEqual({ ok: false, erros: { nome: M.nome } });
  });

  it('nome de 2 e de 100 caracteres é aceito', () => {
    expect(validarDadosServico({ ...valido, nome: 'Ab' }).ok).toBe(true);
    expect(validarDadosServico({ ...valido, nome: 'a'.repeat(100) }).ok).toBe(true);
  });

  it('profissionais inválidos → erro de profissionais (mesma mensagem)', () => {
    for (const profissionais of ['abc', ['abc'], [42], null, Array.from({ length: 201 }, () => P1)]) {
      expect(validarDadosServico({ ...valido, profissionais })).toEqual({ ok: false, erros: { profissionais: M.profissionais } });
    }
  });

  it('todos os erros de campo voltam juntos', () => {
    expect(validarDadosServico({ nome: '', preco: 'x', duracao: 0, profissionais: ['x'] })).toEqual({
      ok: false,
      erros: { nome: M.nome, preco: M.preco, duracao: M.duracao, profissionais: M.profissionais },
    });
  });

  it('D-16: entrada que não é objeto, com campo extra ou sem `profissionais` → erro de formulário', () => {
    const semProfissionais: Record<string, unknown> = { ...valido };
    delete semProfissionais.profissionais;
    for (const e of [null, undefined, 'texto', [], 42, { ...valido, ativo: false }, { ...valido, id: P1 }, semProfissionais]) {
      expect(validarDadosServico(e), JSON.stringify(e)).toEqual({ ok: false, erros: { formulario: M.formulario } });
    }
  });
});

describe('tipos.ts', () => {
  it('não importa nada de @/server em tempo de execução (o cliente o importa)', () => {
    const fonte = readFileSync(fileURLToPath(new URL('./tipos.ts', import.meta.url)), 'utf8');
    expect(fonte).not.toMatch(/^import\s/m);
    expect(Object.isFrozen(LIMITES_SERVICO)).toBe(true);
    expect(Object.isFrozen(MENSAGENS_SERVICO)).toBe(true);
    expect(M.ajudaPreco).toBe('Ex.: 80,00');
  });
});
