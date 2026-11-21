import { describe, expect, it } from 'vitest';

import { contextoDeSistema, criarTenantContext } from '@/server/tenant/context';

import { MENSAGENS_CONSENTIMENTO } from './tipos';
import {
  ehAceite,
  validarConsentimentoDaReserva,
  validarFinalidade,
  validarOrigemParaContexto,
  validarOrigemParaFinalidade,
} from './validacao';

const SALAO = '11111111-1111-4111-8111-111111111111';
const USUARIO = '22222222-2222-4222-8222-222222222222';
const equipe = criarTenantContext({ usuarioId: USUARIO, papel: 'gestor', salaoId: SALAO, profissionalId: null });
const sistema = contextoDeSistema(SALAO, 'teste');

const RECUSA = { ok: false, erros: { mensagensReserva: MENSAGENS_CONSENTIMENTO.mensagensReserva } };

describe('CA-1: validarConsentimentoDaReserva', () => {
  it.each([
    ['ausente', {}],
    ['false', { mensagensReserva: false }],
    ["'false'", { mensagensReserva: 'false' }],
    ["''", { mensagensReserva: '' }],
    ['0', { mensagensReserva: 0 }],
    ['1', { mensagensReserva: 1 }],
    ["'yes'", { mensagensReserva: 'yes' }],
    ['null', { mensagensReserva: null }],
    ['array', { mensagensReserva: [true] }],
    ['objeto', { mensagensReserva: { on: true } }],
    ['só o convite', { conviteAvaliacao: true }],
    ['entrada undefined', undefined],
    ['entrada null', null],
    ['entrada texto', 'on'],
    ['entrada número', 1],
    ['entrada array', [true]],
    ['protótipo envenenado', JSON.parse('{"__proto__":{"mensagensReserva":true}}')],
    ['constructor', { constructor: { mensagensReserva: true } }],
  ])('%s → recusa sem lançar', (_nome, entrada) => {
    expect(validarConsentimentoDaReserva(entrada)).toEqual(RECUSA);
  });

  it('não lê a cadeia de protótipos', () => {
    const entrada = Object.create({ mensagensReserva: true });
    expect(validarConsentimentoDaReserva(entrada)).toEqual(RECUSA);
  });

  it.each([true, 'on'])('aceite %s → só mensagens_reserva', (v) => {
    expect(validarConsentimentoDaReserva({ mensagensReserva: v })).toEqual({ ok: true, finalidades: ['mensagens_reserva'] });
  });

  it('as duas aceitas → obrigatória primeiro; convite não aceito é omitido; extras ignoradas', () => {
    expect(validarConsentimentoDaReserva({ conviteAvaliacao: 'on', mensagensReserva: true, extra: 1 })).toEqual({
      ok: true,
      finalidades: ['mensagens_reserva', 'convite_avaliacao'],
    });
    expect(validarConsentimentoDaReserva({ mensagensReserva: true, conviteAvaliacao: 'false' })).toEqual({
      ok: true,
      finalidades: ['mensagens_reserva'],
    });
  });
});

describe('ehAceite e validarFinalidade', () => {
  it('ehAceite é estrito', () => {
    expect([true, 'on'].every(ehAceite)).toBe(true);
    expect([false, 'true', 'ON', 1, null, undefined, [], {}].some(ehAceite)).toBe(false);
  });

  it('validarFinalidade só aceita o enum', () => {
    expect(['mensagens_reserva', 'convite_avaliacao', 'publicacao_avaliacao'].every(validarFinalidade)).toBe(true);
    expect([ 'outra', '', null, undefined, 1 ].some(validarFinalidade)).toBe(false);
  });
});

describe('CA-9: origem × contexto e × finalidade', () => {
  it('equipe só com tenant; publico só com sistema', () => {
    expect(() => validarOrigemParaContexto(equipe, 'equipe')).not.toThrow();
    expect(() => validarOrigemParaContexto(sistema, 'publico')).not.toThrow();
    expect(() => validarOrigemParaContexto(equipe, 'publico')).toThrow(RangeError);
    expect(() => validarOrigemParaContexto(sistema, 'equipe')).toThrow(RangeError);
  });

  it('equipe só declara mensagens_reserva', () => {
    expect(() => validarOrigemParaFinalidade('equipe', 'mensagens_reserva')).not.toThrow();
    expect(() => validarOrigemParaFinalidade('equipe', 'convite_avaliacao')).toThrow(RangeError);
    expect(() => validarOrigemParaFinalidade('equipe', 'publicacao_avaliacao')).toThrow(RangeError);
    expect(() => validarOrigemParaFinalidade('publico', 'publicacao_avaliacao')).not.toThrow();
    expect(() => validarOrigemParaFinalidade('x' as never, 'mensagens_reserva')).toThrow(RangeError);
  });
});
