import { describe, expect, it } from 'vitest';

import { contextoDeSistema, criarPublicoContext, criarTenantContext } from '@/server/tenant/context';
import type { ContextoEscopado } from '@/server/tenant/context';

import { MENSAGENS_RESERVA } from './tipos';
import type { EntradaCriarReserva } from './tipos';
import { validarEntradaReserva } from './validacao';

// CA-19 (D-025): validação pura da entrada.

const SALAO = '11111111-1111-4111-8111-111111111111';
const USUARIO = '22222222-2222-4222-8222-222222222222';
const PROF = '33333333-3333-4333-8333-333333333333';
const S1 = '44444444-4444-4444-8444-444444444441';
const S2 = '44444444-4444-4444-8444-444444444442';
const equipe = criarTenantContext({ usuarioId: USUARIO, papel: 'gestor', salaoId: SALAO, profissionalId: null });
const sistema = contextoDeSistema(SALAO, 'teste');

function entrada(sobre: Partial<EntradaCriarReserva> = {}): EntradaCriarReserva {
  return {
    servicoIds: [S1, S2],
    profissionalId: PROF,
    inicio: new Date('2026-12-01T13:00:00.000Z'),
    cliente: { nome: 'Ana Souza', telefone: '(11) 91234-5678' },
    aceites: { mensagensReserva: true },
    agora: new Date('2026-11-21T12:00:00.000Z'),
    ...sobre,
  };
}

function invalido(e: EntradaCriarReserva, ctx: ContextoEscopado = sistema) {
  const v = validarEntradaReserva(e, ctx);
  if (v.ok) throw new Error('esperava inválido');
  return v.erros;
}

describe('validarEntradaReserva', () => {
  it('entrada válida: normaliza telefone, nome e chave; modo padrão normal', () => {
    const v = validarEntradaReserva(entrada({ chaveRequisicao: S1.toUpperCase() }), sistema);
    expect(v).toMatchObject({
      ok: true,
      servicoIds: [S1, S2],
      profissionalId: PROF,
      nome: 'Ana Souza',
      telefoneE164: '+5511912345678',
      chave: S1,
      modo: 'normal',
      idsMalformados: { profissional: false, servicos: false },
    });
  });

  it('telefone estrangeiro, curto ou com letras → invalido/telefone', () => {
    for (const telefone of ['+1 202 555 0143', '123', 'abc-defg', '', null, 42]) {
      expect(invalido(entrada({ cliente: { nome: 'Ana', telefone } })).telefone).toBeTruthy();
    }
  });

  it('nome vazio ou longo → invalido/nome', () => {
    expect(invalido(entrada({ cliente: { nome: '  ', telefone: '11912345678' } })).nome).toBeTruthy();
    expect(invalido(entrada({ cliente: { nome: 'A'.repeat(200), telefone: '11912345678' } })).nome).toBeTruthy();
  });

  it('todos os erros juntos, e nenhum campo extra', () => {
    const erros = invalido(
      entrada({ servicoIds: [], inicio: new Date('2026-12-01T13:00:00.500Z'), chaveRequisicao: 'x', cliente: { nome: '', telefone: '1' } }),
    );
    expect(Object.keys(erros).sort()).toEqual(['chave', 'inicio', 'nome', 'servicos', 'telefone']);
  });

  it('inicio inválido ou sem minuto cheio', () => {
    expect(invalido(entrada({ inicio: new Date(Number.NaN) })).inicio).toBe(MENSAGENS_RESERVA.inicio);
    expect(invalido(entrada({ inicio: new Date('2026-12-01T13:00:30.000Z') })).inicio).toBe(MENSAGENS_RESERVA.inicio);
    expect(invalido(entrada({ inicio: '2026-12-01T13:00:00Z' as unknown as Date })).inicio).toBe(MENSAGENS_RESERVA.inicio);
  });

  it('serviços: vazio, repetido (inclusive por caixa), mais de 10 e não string → invalido/servicos', () => {
    expect(invalido(entrada({ servicoIds: [] })).servicos).toBe(MENSAGENS_RESERVA.servicos);
    expect(invalido(entrada({ servicoIds: [S1, S1] })).servicos).toBeTruthy();
    expect(invalido(entrada({ servicoIds: [S1, S1.toUpperCase()] })).servicos).toBeTruthy();
    const onze = Array.from({ length: 11 }, (_, i) => `44444444-4444-4444-8444-${String(i).padStart(12, '0')}`);
    expect(invalido(entrada({ servicoIds: onze })).servicos).toBeTruthy();
    expect(invalido(entrada({ servicoIds: [1, 2] as unknown as string[] })).servicos).toBeTruthy();
    expect(invalido(entrada({ servicoIds: 'x' as unknown as string[] })).servicos).toBeTruthy();
  });

  it('chave não UUID → invalido/chave; ausente ou nula → null', () => {
    expect(invalido(entrada({ chaveRequisicao: 'abc' })).chave).toBe(MENSAGENS_RESERVA.chave);
    expect(validarEntradaReserva(entrada({ chaveRequisicao: null }), sistema)).toMatchObject({ ok: true, chave: null });
    expect(validarEntradaReserva(entrada(), sistema)).toMatchObject({ ok: true, chave: null });
  });

  it('ids malformados não são inválidos: marcam indisponibilidade sem banco (A-15)', () => {
    expect(validarEntradaReserva(entrada({ profissionalId: 'xyz' }), sistema)).toMatchObject({
      ok: true,
      idsMalformados: { profissional: true, servicos: false },
    });
    expect(validarEntradaReserva(entrada({ servicoIds: [S1, 'nao-uuid'] }), sistema)).toMatchObject({
      ok: true,
      idsMalformados: { profissional: false, servicos: true },
    });
  });

  it('agora inválido lança RangeError antes de tudo', () => {
    expect(() => validarEntradaReserva(entrada({ agora: new Date(Number.NaN) }), sistema)).toThrow(RangeError);
    expect(() => validarEntradaReserva(entrada({ agora: undefined as unknown as Date }), sistema)).toThrow(RangeError);
  });

  it('modo desconhecido lança RangeError; encaixe no público lança; na equipe é aceito', () => {
    expect(() => validarEntradaReserva(entrada({ modo: 'x' as 'normal' }), equipe)).toThrow(RangeError);
    expect(() => validarEntradaReserva(entrada({ modo: 'encaixe' }), sistema)).toThrow(RangeError);
    expect(validarEntradaReserva(entrada({ modo: 'encaixe' }), equipe)).toMatchObject({ ok: true, modo: 'encaixe' });
  });

  it('contexto que não é de tenant nem de sistema lança Error', () => {
    const publico = criarPublicoContext(SALAO, 'slug') as unknown as ContextoEscopado;
    expect(() => validarEntradaReserva(entrada(), publico)).toThrow(Error);
  });
});
