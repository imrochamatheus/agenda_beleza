import { describe, expect, it } from 'vitest';

import { LIMITES_CLIENTE, MENSAGENS_CLIENTE } from './tipos';
import {
  chaveDeBusca,
  lerBusca,
  lerPagina,
  validarEntradaCliente,
  validarNomeCliente,
  validarTelefoneCliente,
} from './validacao';

// D-022 T-1: CA-1/CA-2/CA-3 (validação pela entrada do upsert e da edição), CA-8/CA-9 (busca e página).

describe('validarTelefoneCliente (CA-1, CA-2)', () => {
  it.each(['(11) 98765-4321', '11987654321', '+55 11 98765-4321', '5511987654321', '(11)98765.4321'])('%s → +5511987654321', (v) => {
    expect(validarTelefoneCliente(v)).toEqual({ ok: true, valor: '+5511987654321' });
  });

  it('fixo de 10 dígitos', () => {
    expect(validarTelefoneCliente('(11) 3456-7890')).toEqual({ ok: true, valor: '+551134567890' });
  });

  it.each([
    '+1 415 555 0100',
    '(00) 98765-4321',
    '(20) 98765-4321',
    '0800 123 4567',
    '(11) 8765-432',
    '(11) 88765-4321',
    'abc',
    '1'.repeat(31),
    '',
    null,
    undefined,
    42,
    {},
    ['11987654321'],
  ])('recusa %j com a mensagem pt-BR', (v) => {
    expect(validarTelefoneCliente(v)).toEqual({ ok: false, erro: MENSAGENS_CLIENTE.telefone });
  });
});

describe('validarNomeCliente (CA-3)', () => {
  it('apara e colapsa espaços', () => {
    expect(validarNomeCliente('  Maria   S. ')).toEqual({ ok: true, valor: 'Maria S.' });
  });

  it('limites 2 e 100', () => {
    expect(validarNomeCliente('Al')).toMatchObject({ ok: true });
    expect(validarNomeCliente('a'.repeat(100))).toMatchObject({ ok: true });
    expect(validarNomeCliente('a'.repeat(101))).toEqual({ ok: false, erro: MENSAGENS_CLIENTE.nomeTamanho });
    expect(validarNomeCliente('A')).toEqual({ ok: false, erro: MENSAGENS_CLIENTE.nomeTamanho });
  });

  it.each(['', '   ', null, undefined, 7, {}, []])('vazio ou não texto %j → obrigatório', (v) => {
    expect(validarNomeCliente(v)).toEqual({ ok: false, erro: MENSAGENS_CLIENTE.nomeObrigatorio });
  });

  it('quebra de linha ou controle → tamanho/forma', () => {
    expect(validarNomeCliente('Ma\nria')).toEqual({ ok: false, erro: MENSAGENS_CLIENTE.nomeTamanho });
    expect(validarNomeCliente('Ma\u0000ria')).toEqual({ ok: false, erro: MENSAGENS_CLIENTE.nomeTamanho });
  });

  it('HTML é texto (escapado na exibição)', () => {
    expect(validarNomeCliente('<script>x</script>')).toEqual({ ok: true, valor: '<script>x</script>' });
  });
});

describe('validarEntradaCliente (CA-2, CA-18)', () => {
  it('ok normaliza os dois', () => {
    expect(validarEntradaCliente({ nome: ' Ana  Lima ', telefone: '(21) 91234-5678' })).toEqual({
      ok: true,
      nome: 'Ana Lima',
      telefoneE164: '+5521912345678',
    });
  });

  it('todos os erros juntos', () => {
    expect(validarEntradaCliente({ nome: 'A', telefone: 'abc' })).toEqual({
      ok: false,
      erros: { telefone: MENSAGENS_CLIENTE.telefone, nome: MENSAGENS_CLIENTE.nomeTamanho },
    });
  });

  it('só um campo inválido', () => {
    expect(validarEntradaCliente({ nome: 'Ana', telefone: '1' })).toEqual({ ok: false, erros: { telefone: MENSAGENS_CLIENTE.telefone } });
    expect(validarEntradaCliente({ nome: '', telefone: '11987654321' })).toEqual({ ok: false, erros: { nome: MENSAGENS_CLIENTE.nomeObrigatorio } });
  });

  it('entrada não objeto não lança', () => {
    expect(validarEntradaCliente(undefined as never)).toMatchObject({ ok: false });
  });
});

describe('chaveDeBusca e lerBusca (CA-8)', () => {
  it('sem acento e minúsculas', () => {
    expect(chaveDeBusca('Ana Júlia')).toBe('ana julia');
    expect(chaveDeBusca('ZÉLIA')).toBe('zelia');
    expect(chaveDeBusca('Ço Ñandú')).toBe('co nandu');
  });

  it('apara, colapsa, remove controle e corta em 80', () => {
    expect(lerBusca('  a   c  ')).toMatchObject({ q: 'a c', nome: 'a c', digitos: null });
    expect(lerBusca('a\u0000b\tc')).toMatchObject({ q: 'a b c' });
    expect(lerBusca('x'.repeat(200)).q).toHaveLength(LIMITES_CLIENTE.buscaMax);
  });

  it('corta por pontos de código (sem metade de par substituto)', () => {
    const q = lerBusca('😀'.repeat(100)).q;
    expect(Array.from(q)).toHaveLength(80);
    expect(q.isWellFormed()).toBe(true);
  });

  it('não texto → vazio', () => {
    expect(lerBusca(undefined)).toEqual({ q: '', nome: '', digitos: null });
    expect(lerBusca(['a'])).toEqual({ q: '', nome: '', digitos: null });
  });

  it('% _ \\ são literais (só viram texto de busca)', () => {
    expect(lerBusca('%')).toMatchObject({ nome: '%', digitos: null });
    expect(lerBusca('_')).toMatchObject({ nome: '_' });
    expect(lerBusca('\\')).toMatchObject({ nome: '\\' });
  });

  it.each([
    ['98765', '98765'],
    ['(11) 98765', '1198765'],
    ['+55 11 9', '55119'],
    ['5511987654321', '5511987654321'],
    ['987654321', '987654321'],
    ['11.9-8', '1198'],
  ])('telefone %s → dígitos %s', (q, d) => {
    expect(lerBusca(q).digitos).toBe(d);
  });

  it.each(['12', '(1) 2', 'xyz', '98765a', '9 8 7 a', '+'])('sem critério de telefone: %s', (q) => {
    expect(lerBusca(q).digitos).toBeNull();
  });
});

describe('lerPagina (CA-9)', () => {
  it.each([
    ['1', 1],
    ['2', 2],
    ['3', 3],
    ['4', 4],
    ['9999999', 9999999],
    ['0', 1],
    ['-1', 1],
    ['abc', 1],
    ['1.5', 1],
    ['01', 1],
    ['', 1],
    ['99999999999999999999', 1],
    ['10000000', 1],
    [undefined, 1],
    [['2'], 1],
    [2, 1],
  ])('%j → %d', (v, esperado) => {
    expect(lerPagina(v)).toBe(esperado);
  });
});
