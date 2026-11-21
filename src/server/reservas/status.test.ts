import { describe, expect, it } from 'vitest';

import type { StatusReserva } from '@/server/repos/tipos';

import { acoesPermitidas, decidirTransicao, podeRemarcar } from './status';

const inicio = new Date('2026-12-01T13:00:00Z');
const fim = new Date('2026-12-01T14:00:00Z');
const antes = new Date('2026-12-01T12:00:00Z');
const durante = new Date('2026-12-01T13:30:00Z');
const T = (de: StatusReserva, para: StatusReserva, agora: Date) => decidirTransicao({ de, para, inicio, fim, agora });
const TODOS: StatusReserva[] = ['confirmado', 'cancelado', 'concluido', 'nao_compareceu'];

describe('decidirTransicao (CA-4, CA-7)', () => {
  it('cancelado é final: toda transição recusada', () => {
    for (const para of TODOS) expect(T('cancelado', para, durante)).toEqual({ ok: false, motivo: 'reserva_final' });
  });
  it('mesma-para-mesma é recusada', () => {
    for (const s of ['confirmado', 'concluido', 'nao_compareceu'] as const) {
      expect(T(s, s, durante)).toEqual({ ok: false, motivo: 'transicao_invalida' });
    }
  });
  it('cancelar: aceita com agora < fim; recusa em agora == fim e depois', () => {
    expect(T('confirmado', 'cancelado', antes)).toEqual({ ok: true });
    expect(T('confirmado', 'cancelado', durante)).toEqual({ ok: true });
    expect(T('confirmado', 'cancelado', new Date(fim.getTime() - 1))).toEqual({ ok: true });
    expect(T('confirmado', 'cancelado', fim)).toEqual({ ok: false, motivo: 'ja_terminada' });
    expect(T('confirmado', 'cancelado', new Date(fim.getTime() + 1))).toEqual({ ok: false, motivo: 'ja_terminada' });
  });
  it('concluir e não compareceu: só com agora >= início (fronteira aceita)', () => {
    for (const para of ['concluido', 'nao_compareceu'] as const) {
      expect(T('confirmado', para, antes)).toEqual({ ok: false, motivo: 'ainda_nao_iniciada' });
      expect(T('confirmado', para, new Date(inicio.getTime() - 1))).toEqual({ ok: false, motivo: 'ainda_nao_iniciada' });
      expect(T('confirmado', para, inicio)).toEqual({ ok: true });
      expect(T('confirmado', para, new Date(fim.getTime() + 1))).toEqual({ ok: true });
    }
  });
  it('concluido e nao_compareceu alternam nos dois sentidos, em qualquer instante', () => {
    expect(T('concluido', 'nao_compareceu', antes)).toEqual({ ok: true });
    expect(T('nao_compareceu', 'concluido', antes)).toEqual({ ok: true });
  });
  it('concluido ou nao_compareceu nunca cancelam nem voltam a confirmado', () => {
    for (const de of ['concluido', 'nao_compareceu'] as const) {
      expect(T(de, 'cancelado', durante)).toEqual({ ok: false, motivo: 'transicao_invalida' });
      expect(T(de, 'confirmado', durante)).toEqual({ ok: false, motivo: 'transicao_invalida' });
    }
  });
  it('confirmado nunca "volta" para confirmado', () => {
    expect(T('confirmado', 'confirmado', durante).ok).toBe(false);
  });
});

describe('podeRemarcar e acoesPermitidas (CA-13)', () => {
  it('só confirmado remarca', () => {
    expect(TODOS.filter(podeRemarcar)).toEqual(['confirmado']);
  });
  it('reflete a máquina', () => {
    expect(acoesPermitidas({ status: 'confirmado', inicio, fim, agora: antes })).toEqual({ remarcar: true, cancelar: true, concluir: false, naoCompareceu: false });
    expect(acoesPermitidas({ status: 'confirmado', inicio, fim, agora: durante })).toEqual({ remarcar: true, cancelar: true, concluir: true, naoCompareceu: true });
    expect(acoesPermitidas({ status: 'confirmado', inicio, fim, agora: fim })).toEqual({ remarcar: true, cancelar: false, concluir: true, naoCompareceu: true });
    expect(acoesPermitidas({ status: 'concluido', inicio, fim, agora: fim })).toEqual({ remarcar: false, cancelar: false, concluir: false, naoCompareceu: true });
    expect(acoesPermitidas({ status: 'cancelado', inicio, fim, agora: antes })).toEqual({ remarcar: false, cancelar: false, concluir: false, naoCompareceu: false });
  });
});
