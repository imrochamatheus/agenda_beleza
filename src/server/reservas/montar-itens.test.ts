import { describe, expect, it } from 'vitest';

import type { ItemDeReservaDTO, ReservaDTO } from '@/server/repos/tipos';

import { conferirCompativel, itensCriados, montarItens, paraReservaCriada } from './montar-itens';

// D-025 CA-17 / D-050 §3.5 passo 5 (RN-4, RN-5): montagem pura dos itens, cada um com profissional e
// início próprios, sem encadeamento.

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const INICIO = new Date('2026-12-01T13:00:00.000Z');
const MIN = 60_000;
const em = (min: number) => new Date(INICIO.getTime() + min * MIN);
const SERVICOS = new Map([
  [ID(1), { precoCentavos: 5000, duracaoMin: 30 }],
  [ID(2), { precoCentavos: 7000, duracaoMin: 45 }],
]);

describe('montarItens', () => {
  it('cada item: fim = início + duração do serviço, ocupadoAte = fim + intervalo, ordem = posição, encaixe false', () => {
    const itens = montarItens(
      [
        { servicoId: ID(2), profissionalId: ID(51), inicio: em(120) },
        { servicoId: ID(1).toUpperCase(), profissionalId: ID(50).toUpperCase(), inicio: INICIO },
      ],
      SERVICOS,
      10,
    );
    expect(itens).toEqual([
      { servicoId: ID(2), profissionalId: ID(51), ordem: 0, inicio: em(120), fim: em(165), ocupadoAte: em(175), precoCentavos: 7000, duracaoMin: 45, encaixe: false },
      { servicoId: ID(1), profissionalId: ID(50), ordem: 1, inicio: INICIO, fim: em(30), ocupadoAte: em(40), precoCentavos: 5000, duracaoMin: 30, encaixe: false },
    ]);
  });

  it('intervalo 0: ocupadoAte = fim; sem encadeamento entre itens do mesmo profissional', () => {
    const itens = montarItens(
      [
        { servicoId: ID(1), profissionalId: ID(50), inicio: INICIO },
        { servicoId: ID(2), profissionalId: ID(50), inicio: INICIO },
      ],
      SERVICOS,
      0,
    );
    expect(itens.map((i) => [i.inicio, i.fim, i.ocupadoAte])).toEqual([
      [INICIO, em(30), em(30)],
      [INICIO, em(45), em(45)],
    ]);
  });

  it('erros de programação: intervalo inválido, serviço sem snapshot, duração inválida e início inválido', () => {
    const p = [{ servicoId: ID(1), profissionalId: ID(50), inicio: INICIO }];
    expect(() => montarItens(p, SERVICOS, -1)).toThrow(RangeError);
    expect(() => montarItens(p, SERVICOS, 1.5)).toThrow(RangeError);
    expect(() => montarItens([{ ...p[0], servicoId: ID(3) }], SERVICOS, 0)).toThrow(RangeError);
    expect(() => montarItens(p, new Map([[ID(1), { precoCentavos: 1, duracaoMin: 0 }]]), 0)).toThrow(RangeError);
    expect(() => montarItens(p, new Map([[ID(1), { precoCentavos: 1, duracaoMin: 2.5 }]]), 0)).toThrow(RangeError);
    expect(() => montarItens([{ ...p[0], inicio: new Date(Number.NaN) }], SERVICOS, 0)).toThrow(RangeError);
    expect(montarItens([], SERVICOS, 0)).toEqual([]);
  });
});

describe('itensCriados', () => {
  it('casa os ids por ordem, marca confirmado e ordena por (inicio, id)', () => {
    const itens = montarItens(
      [
        { servicoId: ID(2), profissionalId: ID(51), inicio: em(60) },
        { servicoId: ID(1), profissionalId: ID(50), inicio: INICIO },
      ],
      SERVICOS,
      0,
    );
    const criados = itensCriados(itens, [
      { id: ID(91), ordem: 1 },
      { id: ID(90), ordem: 0 },
    ]);
    expect(criados.map((i) => [i.id, i.ordem, i.servicoId, i.status])).toEqual([
      [ID(91), 1, ID(1), 'confirmado'],
      [ID(90), 0, ID(2), 'confirmado'],
    ]);
  });

  it('id faltando é erro', () => {
    const itens = montarItens([{ servicoId: ID(1), profissionalId: ID(50), inicio: INICIO }], SERVICOS, 0);
    expect(() => itensCriados(itens, [])).toThrow(Error);
  });
});

function item(sobre: Partial<ItemDeReservaDTO>): ItemDeReservaDTO {
  return {
    id: ID(80),
    servicoId: ID(1),
    profissionalId: ID(50),
    ordem: 0,
    inicio: INICIO,
    fim: em(30),
    ocupadoAte: em(30),
    status: 'confirmado',
    encaixe: false,
    revisao: 0,
    precoCentavos: 5000,
    duracaoMin: 30,
    ...sobre,
  };
}

function dto(sobre: Partial<ReservaDTO> = {}): ReservaDTO {
  return {
    id: ID(99),
    clienteId: ID(60),
    inicio: INICIO,
    fim: em(105),
    status: 'confirmado',
    origem: 'publico',
    revisao: 0,
    canceladaEm: null,
    itens: [
      item({ id: ID(82), servicoId: ID(2), profissionalId: ID(51), ordem: 0, inicio: em(60), fim: em(105), ocupadoAte: em(115), encaixe: true, duracaoMin: 45, precoCentavos: 7000 }),
      item({ id: ID(81), ordem: 1 }),
    ],
    ...sobre,
  };
}

describe('paraReservaCriada', () => {
  it('copia os itens com profissional, horários e flags, por (inicio, id), sem dado da cliente', () => {
    const c = paraReservaCriada(dto());
    expect(c.itens.map((i) => [i.id, i.ordem, i.profissionalId, i.inicio, i.fim, i.ocupadoAte, i.encaixe, i.status])).toEqual([
      [ID(81), 1, ID(50), INICIO, em(30), em(30), false, 'confirmado'],
      [ID(82), 0, ID(51), em(60), em(105), em(115), true, 'confirmado'],
    ]);
    expect(c).toMatchObject({ id: ID(99), status: 'confirmado', origem: 'publico', revisao: 0, clienteId: ID(60), inicio: INICIO, fim: em(105) });
    expect(Object.keys(c).sort()).toEqual(['clienteId', 'fim', 'id', 'inicio', 'itens', 'origem', 'revisao', 'status']);
  });

  it('desempate por id quando o início é igual', () => {
    const c = paraReservaCriada(dto({ itens: [item({ id: ID(84) }), item({ id: ID(83), servicoId: ID(2), profissionalId: ID(51) })] }));
    expect(c.itens.map((i) => i.id)).toEqual([ID(83), ID(84)]);
  });
});

describe('conferirCompativel (RN-14: conjunto de {serviço, profissional, início})', () => {
  const pedido = [
    { servicoId: ID(1), profissionalId: ID(50), inicio: INICIO },
    { servicoId: ID(2), profissionalId: ID(51), inicio: em(60) },
  ];

  it('mesmo conjunto, em qualquer ordem e sem caixa', () => {
    expect(conferirCompativel(dto(), pedido)).toBe(true);
    expect(conferirCompativel(dto(), [...pedido].reverse())).toBe(true);
    expect(conferirCompativel(dto(), pedido.map((p) => ({ ...p, profissionalId: p.profissionalId.toUpperCase(), servicoId: p.servicoId.toUpperCase() })))).toBe(true);
  });

  it('outro profissional, outro início, item a mais ou a menos, outro serviço', () => {
    expect(conferirCompativel(dto(), [pedido[0], { ...pedido[1], profissionalId: ID(50) }])).toBe(false);
    expect(conferirCompativel(dto(), [pedido[0], { ...pedido[1], inicio: em(61) }])).toBe(false);
    expect(conferirCompativel(dto(), [pedido[0]])).toBe(false);
    expect(conferirCompativel(dto(), [...pedido, { servicoId: ID(3), profissionalId: ID(50), inicio: em(200) }])).toBe(false);
    expect(conferirCompativel(dto(), [pedido[0], { ...pedido[1], servicoId: ID(3) }])).toBe(false);
  });
});
