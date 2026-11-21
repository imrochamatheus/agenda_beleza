import { describe, expect, it } from 'vitest';

import type { ReservaDTO } from '@/server/repos/tipos';

import { conferirCompativel, montarItens, paraReservaCriada } from './montar-itens';

// CA-17 (D-025): montagem pura dos itens e do intervalo.

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const INICIO = new Date('2026-12-01T13:00:00.000Z');
const MIN = 60_000;

describe('montarItens', () => {
  it('um serviço: um item, fim = início + duração, ocupadoAte = fim + intervalo', () => {
    const r = montarItens(INICIO, [{ servicoId: ID(1), precoCentavos: 5000, duracaoMin: 30 }], 10);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.itens).toEqual([
      { servicoId: ID(1), ordem: 0, precoCentavos: 5000, duracaoMin: 30, inicio: INICIO, fim: new Date(INICIO.getTime() + 30 * MIN) },
    ]);
    expect(r.fim.getTime()).toBe(INICIO.getTime() + 30 * MIN);
    expect(r.ocupadoAte.getTime()).toBe(INICIO.getTime() + 40 * MIN);
  });

  it('dois serviços: consecutivos, snapshots copiados, o intervalo só depois do último', () => {
    const r = montarItens(
      INICIO,
      [
        { servicoId: ID(1), precoCentavos: 5000, duracaoMin: 30 },
        { servicoId: ID(2), precoCentavos: 7000, duracaoMin: 45 },
      ],
      0,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.itens.map((i) => [i.ordem, i.precoCentavos, i.duracaoMin])).toEqual([
      [0, 5000, 30],
      [1, 7000, 45],
    ]);
    expect(r.itens[0].fim.getTime()).toBe(r.itens[1].inicio.getTime());
    expect(r.itens[1].fim.getTime()).toBe(r.fim.getTime());
    expect(r.fim.getTime() - INICIO.getTime()).toBe(75 * MIN);
    expect(r.ocupadoAte.getTime()).toBe(r.fim.getTime());
  });

  it('dez serviços: ordens 0..9, soma das durações = fim - início, preço zero permitido', () => {
    const servicos = Array.from({ length: 10 }, (_, i) => ({ servicoId: ID(i + 1), precoCentavos: i === 3 ? 0 : 1000 * i, duracaoMin: 5 + 5 * i }));
    const r = montarItens(INICIO, servicos, 15);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.itens.map((i) => i.ordem)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const soma = servicos.reduce((t, s) => t + s.duracaoMin, 0);
    expect(r.fim.getTime() - INICIO.getTime()).toBe(soma * MIN);
    expect(r.ocupadoAte.getTime() - r.fim.getTime()).toBe(15 * MIN);
    expect(r.itens[3].precoCentavos).toBe(0);
    for (let i = 1; i < 10; i++) expect(r.itens[i].inicio.getTime()).toBe(r.itens[i - 1].fim.getTime());
  });

  it('virada de dia e de horário de verão em UTC: só milissegundos, sem Intl', () => {
    const virada = new Date('2026-12-31T23:30:00.000Z');
    const r = montarItens(virada, [{ servicoId: ID(1), precoCentavos: 1, duracaoMin: 90 }], 0);
    expect(r.ok && r.fim.toISOString()).toBe('2027-01-01T01:00:00.000Z');
    const verao = new Date('2026-11-01T04:30:00.000Z');
    const v = montarItens(verao, [{ servicoId: ID(1), precoCentavos: 1, duracaoMin: 120 }], 0);
    expect(v.ok && v.fim.toISOString()).toBe('2026-11-01T06:30:00.000Z');
  });

  it('entradas inválidas são recusadas sem lançar', () => {
    const um = { servicoId: ID(1), precoCentavos: 1, duracaoMin: 30 };
    expect(montarItens(INICIO, [], 0)).toEqual({ ok: false, motivo: 'servicos_vazio' });
    expect(montarItens(INICIO, [um, um], 0)).toEqual({ ok: false, motivo: 'servicos_repetidos' });
    const onze = Array.from({ length: 11 }, (_, i) => ({ ...um, servicoId: ID(i + 1) }));
    expect(montarItens(INICIO, onze, 0)).toEqual({ ok: false, motivo: 'servicos_demais' });
    expect(montarItens(INICIO, [{ ...um, duracaoMin: 0 }], 0)).toEqual({ ok: false, motivo: 'duracao_invalida' });
    expect(montarItens(INICIO, [{ ...um, duracaoMin: -5 }], 0)).toEqual({ ok: false, motivo: 'duracao_invalida' });
    expect(montarItens(INICIO, [{ ...um, duracaoMin: 1.5 }], 0)).toEqual({ ok: false, motivo: 'duracao_invalida' });
    expect(montarItens(INICIO, [um], -1)).toEqual({ ok: false, motivo: 'duracao_invalida' });
    expect(montarItens(new Date(Number.NaN), [um], 0)).toEqual({ ok: false, motivo: 'duracao_invalida' });
  });
});

function dto(sobre: Partial<ReservaDTO> = {}): ReservaDTO {
  return {
    id: ID(99),
    profissionalId: ID(50),
    clienteId: ID(60),
    inicio: INICIO,
    fim: new Date(INICIO.getTime() + 75 * MIN),
    ocupadoAte: new Date(INICIO.getTime() + 85 * MIN),
    status: 'confirmado',
    origem: 'publico',
    encaixe: false,
    revisao: 0,
    itens: [
      { servicoId: ID(2), ordem: 1, precoCentavos: 7000, duracaoMin: 45 },
      { servicoId: ID(1), ordem: 0, precoCentavos: 5000, duracaoMin: 30 },
    ],
    ...sobre,
  };
}

describe('paraReservaCriada', () => {
  it('ordena os itens e recalcula início e fim por soma consecutiva', () => {
    const c = paraReservaCriada(dto());
    expect(c.itens.map((i) => [i.servicoId, i.ordem])).toEqual([
      [ID(1), 0],
      [ID(2), 1],
    ]);
    expect(c.itens[0].inicio).toEqual(INICIO);
    expect(c.itens[0].fim.getTime()).toBe(INICIO.getTime() + 30 * MIN);
    expect(c.itens[1].inicio.getTime()).toBe(INICIO.getTime() + 30 * MIN);
    expect(c.itens[1].fim.getTime()).toBe(INICIO.getTime() + 75 * MIN);
    expect(c).toMatchObject({ id: ID(99), status: 'confirmado', origem: 'publico', encaixe: false, revisao: 0, clienteId: ID(60) });
    expect(Object.keys(c)).not.toContain('nome');
  });
});

describe('conferirCompativel', () => {
  const pedido = { profissionalId: ID(50), inicio: INICIO, servicoIds: [ID(1), ID(2)] };
  it('mesmo profissional, início e serviços na ordem', () => {
    expect(conferirCompativel(dto(), pedido)).toBe(true);
    expect(conferirCompativel(dto(), { ...pedido, profissionalId: ID(50).toUpperCase() })).toBe(true);
  });
  it('outro profissional, início, ordem ou conjunto de serviços', () => {
    expect(conferirCompativel(dto(), { ...pedido, profissionalId: ID(51) })).toBe(false);
    expect(conferirCompativel(dto(), { ...pedido, inicio: new Date(INICIO.getTime() + MIN) })).toBe(false);
    expect(conferirCompativel(dto(), { ...pedido, servicoIds: [ID(2), ID(1)] })).toBe(false);
    expect(conferirCompativel(dto(), { ...pedido, servicoIds: [ID(1)] })).toBe(false);
    expect(conferirCompativel(dto(), { ...pedido, servicoIds: [ID(1), ID(3)] })).toBe(false);
  });
});
