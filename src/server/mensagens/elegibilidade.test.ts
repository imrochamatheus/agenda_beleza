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

describe('conferirVigencia (RN-16; CA-15)', () => {
  it.each(['confirmacao', 'remarcacao'] as const)('%s: mesma revisão e confirmado', (tipo) => {
    expect(conferirVigencia(tipo, { revisao: 1 }, { revisao: 1, status: 'confirmado' })).toBe('vigente');
    expect(conferirVigencia(tipo, { revisao: 0 }, { revisao: 1, status: 'confirmado' })).toBe('obsoleta');
    expect(conferirVigencia(tipo, { revisao: 1 }, { revisao: 1, status: 'cancelado' })).toBe('obsoleta');
    expect(conferirVigencia(tipo, { revisao: 1 }, { revisao: 1, status: 'concluido' })).toBe('obsoleta');
  });

  it('cancelamento: mesma revisão e cancelado', () => {
    expect(conferirVigencia('cancelamento', { revisao: 2 }, { revisao: 2, status: 'cancelado' })).toBe('vigente');
    expect(conferirVigencia('cancelamento', { revisao: 1 }, { revisao: 2, status: 'cancelado' })).toBe('obsoleta');
    expect(conferirVigencia('cancelamento', { revisao: 2 }, { revisao: 2, status: 'confirmado' })).toBe('obsoleta');
  });

  it('convite_avaliacao: só reserva concluída, qualquer revisão', () => {
    expect(conferirVigencia('convite_avaliacao', { revisao: 0 }, { revisao: 3, status: 'concluido' })).toBe('vigente');
    expect(conferirVigencia('convite_avaliacao', { revisao: 0 }, { revisao: 0, status: 'confirmado' })).toBe('obsoleta');
    expect(conferirVigencia('convite_avaliacao', { revisao: 0 }, { revisao: 0, status: 'nao_compareceu' })).toBe('obsoleta');
  });
});
