import { describe, expect, it } from 'vitest';

import { conferirVigencia, decidirElegibilidade } from './elegibilidade';
import type { EntradaElegibilidade } from './elegibilidade';
import type { TipoMensagem } from './tipos';

const TIPOS: TipoMensagem[] = ['confirmacao', 'remarcacao', 'cancelamento', 'convite_avaliacao'];
const base = (o: Partial<EntradaElegibilidade>): EntradaElegibilidade => ({
  tipo: 'confirmacao',
  clienteAnonimizada: false,
  telefone: '+5511987654321',
  consentimentoMensagens: true,
  consentimentoConvite: true,
  ...o,
});

describe('decidirElegibilidade (RN-8, RN-12; CA-13, CA-14)', () => {
  it.each(['confirmacao', 'remarcacao', 'cancelamento'] as const)('%s exige mensagens_reserva', (tipo) => {
    expect(decidirElegibilidade(base({ tipo }))).toEqual({ acao: 'enviar' });
    expect(decidirElegibilidade(base({ tipo, consentimentoMensagens: false, consentimentoConvite: true }))).toEqual({
      acao: 'terminal',
      estado: 'nao_enviada',
      erroCodigo: 'sem_consentimento',
    });
  });

  it('convite_avaliacao exige só a finalidade convite_avaliacao', () => {
    const tipo = 'convite_avaliacao';
    expect(decidirElegibilidade(base({ tipo, consentimentoMensagens: false }))).toEqual({ acao: 'enviar' });
    expect(decidirElegibilidade(base({ tipo, consentimentoMensagens: true, consentimentoConvite: false }))).toEqual({
      acao: 'terminal',
      estado: 'nao_enviada',
      erroCodigo: 'sem_consentimento',
    });
  });

  it.each(TIPOS)('%s: cliente anonimizada ou sem telefone → cancelada_anonimizacao', (tipo) => {
    const esperado = { acao: 'terminal', estado: 'cancelada_anonimizacao', erroCodigo: null };
    expect(decidirElegibilidade(base({ tipo, clienteAnonimizada: true }))).toEqual(esperado);
    expect(decidirElegibilidade(base({ tipo, telefone: null }))).toEqual(esperado);
    // a anonimização vence a falta de consentimento
    expect(
      decidirElegibilidade(base({ tipo, clienteAnonimizada: true, consentimentoMensagens: false, consentimentoConvite: false })),
    ).toEqual(esperado);
  });
});

describe('conferirVigencia (D-050 RN-30; M-4)', () => {
  const it_ = (revisao: number, status: 'confirmado' | 'cancelado' | 'concluido' | 'nao_compareceu') => ({ revisao, status });

  it('confirmacao: vigente enquanto o status derivado é confirmado, qualquer revisão (RN-27/RN-31)', () => {
    expect(conferirVigencia('confirmacao', { revisao: 0 }, { status: 'confirmado', itens: [it_(3, 'confirmado')] })).toBe('vigente');
    for (const status of ['cancelado', 'concluido', 'nao_compareceu'] as const) {
      expect(conferirVigencia('confirmacao', { revisao: 0 }, { status, itens: [it_(0, 'confirmado')] })).toBe('obsoleta');
    }
  });

  it('remarcacao: existe item com a revisão da mensagem e ainda confirmado', () => {
    const r = { status: 'confirmado' as const, itens: [it_(0, 'confirmado'), it_(2, 'confirmado'), it_(3, 'cancelado')] };
    expect(conferirVigencia('remarcacao', { revisao: 2 }, r)).toBe('vigente');
    // remarcação posterior do mesmo item: a anterior (rev 1) já não tem item na revisão 1 (CA-40)
    expect(conferirVigencia('remarcacao', { revisao: 1 }, r)).toBe('obsoleta');
    // o item da revisão 3 foi cancelado
    expect(conferirVigencia('remarcacao', { revisao: 3 }, r)).toBe('obsoleta');
    expect(conferirVigencia('remarcacao', { revisao: 2 }, { status: 'concluido', itens: [it_(2, 'concluido')] })).toBe('obsoleta');
  });

  it('cancelamento: existe item com a revisão da mensagem ainda cancelado (CA-38: rev 1 e rev 2 vigentes)', () => {
    const r = { status: 'cancelado' as const, itens: [it_(1, 'cancelado'), it_(2, 'cancelado')] };
    expect(conferirVigencia('cancelamento', { revisao: 1 }, r)).toBe('vigente');
    expect(conferirVigencia('cancelamento', { revisao: 2 }, r)).toBe('vigente');
    expect(conferirVigencia('cancelamento', { revisao: 3 }, r)).toBe('obsoleta');
    expect(conferirVigencia('cancelamento', { revisao: 1 }, { status: 'confirmado', itens: [it_(1, 'confirmado')] })).toBe('obsoleta');
  });

  it('convite_avaliacao: só status derivado concluido', () => {
    expect(conferirVigencia('convite_avaliacao', { revisao: 0 }, { status: 'concluido', itens: [it_(3, 'concluido')] })).toBe('vigente');
    expect(conferirVigencia('convite_avaliacao', { revisao: 0 }, { status: 'confirmado', itens: [it_(0, 'concluido')] })).toBe('obsoleta');
    expect(conferirVigencia('convite_avaliacao', { revisao: 0 }, { status: 'nao_compareceu', itens: [] })).toBe('obsoleta');
  });

  it('reserva sem itens: remarcação e cancelamento são obsoletos', () => {
    expect(conferirVigencia('remarcacao', { revisao: 0 }, { status: 'confirmado', itens: [] })).toBe('obsoleta');
    expect(conferirVigencia('cancelamento', { revisao: 0 }, { status: 'cancelado', itens: [] })).toBe('obsoleta');
  });
});
