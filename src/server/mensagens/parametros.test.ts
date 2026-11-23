import { describe, expect, it } from 'vitest';

import { montarParametros, montarParametrosConvite } from './parametros';
import type { ItemDosParametros } from './parametros';

// 2026-11-21T02:30:00Z = 20/11/2026 23:30 em São Paulo (dia diferente do UTC)
const item = (
  iso: string,
  servicoNome: string,
  profissionalNome: string,
  o: Partial<ItemDosParametros> = {},
): ItemDosParametros => ({
  inicio: new Date(iso),
  status: 'confirmado',
  revisao: 0,
  servicoNome,
  profissionalNome,
  ...o,
});
const dados = (itens: ItemDosParametros[], revisao = 0, fuso = 'America/Sao_Paulo') => ({
  salaoNome: 'Studio Terra',
  fuso,
  itens,
  revisao,
});

describe('montarParametros: confirmação consolidada (D-050 RN-27, CA-37)', () => {
  it('salao, data e itens não cancelados por início, numa linha, com hora, serviço e profissional', () => {
    const p = montarParametros(
      'confirmacao',
      dados([
        // fora de ordem de propósito; o cancelado não entra
        item('2026-11-25T18:00:00Z', 'Manicure', 'Carla'),
        item('2026-11-25T12:00:00Z', 'Escova', 'Ana'),
        item('2026-11-25T14:00:00Z', 'Corte', 'Duda', { status: 'cancelado', revisao: 1 }),
        item('2026-11-25T13:00:00Z', 'Hidratação', 'Bia', { revisao: 2 }),
      ]),
    );
    expect(p).toEqual({
      salao: 'Studio Terra',
      data: '25/11/2026',
      itens: '09:00 Escova com Ana; 10:00 Hidratação com Bia; 15:00 Manicure com Carla',
    });
    expect(Object.keys(p)).toEqual(['salao', 'data', 'itens']);
    expect(p.itens).not.toMatch(/[\r\n]/);
  });

  it('usa o fuso do salão: data e hora do primeiro item no dia local', () => {
    const itens = [item('2026-11-21T02:30:00Z', 'Corte', 'Marina')];
    expect(montarParametros('confirmacao', dados(itens))).toMatchObject({ data: '20/11/2026', itens: '23:30 Corte com Marina' });
    expect(montarParametros('confirmacao', dados(itens, 0, 'UTC'))).toMatchObject({ data: '21/11/2026', itens: '02:30 Corte com Marina' });
  });

  it('quebras de linha em nomes viram espaço', () => {
    const p = montarParametros('confirmacao', {
      ...dados([item('2026-11-25T12:00:00Z', 'Corte\nfeminino', 'Ana\r\nLima')]),
      salaoNome: 'Studio\tTerra',
    });
    expect(p).toEqual({ salao: 'Studio Terra', data: '25/11/2026', itens: '09:00 Corte feminino com Ana Lima' });
  });

  it('todos os itens cancelados → RangeError (a vigência já a teria descartado)', () => {
    expect(() =>
      montarParametros('confirmacao', dados([item('2026-11-25T12:00:00Z', 'Corte', 'Ana', { status: 'cancelado' })])),
    ).toThrow(RangeError);
  });
});

describe('montarParametros: remarcação e cancelamento por item (D-050 RN-29)', () => {
  const itens = [
    item('2026-11-25T12:00:00Z', 'Escova', 'Ana', { revisao: 0 }),
    item('2026-11-25T16:30:00Z', 'Hidratação', 'Bia', { revisao: 2 }),
    item('2026-11-25T13:00:00Z', 'Manicure', 'Carla', { revisao: 1, status: 'cancelado' }),
  ];

  it('remarcacao: só o item com a revisão da mensagem e confirmado', () => {
    expect(montarParametros('remarcacao', dados(itens, 2))).toEqual({
      salao: 'Studio Terra',
      servicos: 'Hidratação',
      profissional: 'Bia',
      data: '25/11/2026',
      horario: '13:30',
    });
  });

  it('cancelamento de um item: só o item cancelado na revisão (sem profissional)', () => {
    expect(montarParametros('cancelamento', dados(itens, 1))).toEqual({
      salao: 'Studio Terra',
      servicos: 'Manicure',
      data: '25/11/2026',
      horario: '10:00',
    });
  });

  it('"cancelar todos": serviços cancelados na mesma revisão por início; data e hora do primeiro', () => {
    const todos = [
      item('2026-11-25T15:00:00Z', 'Manicure', 'Carla', { revisao: 3, status: 'cancelado' }),
      item('2026-11-25T12:00:00Z', 'Escova', 'Ana', { revisao: 3, status: 'cancelado' }),
      item('2026-11-25T13:00:00Z', 'Hidratação', 'Bia', { revisao: 3, status: 'cancelado' }),
      item('2026-11-25T11:00:00Z', 'Corte', 'Ana', { revisao: 0, status: 'concluido' }),
    ];
    expect(montarParametros('cancelamento', dados(todos, 3))).toEqual({
      salao: 'Studio Terra',
      servicos: 'Escova, Hidratação e Manicure',
      data: '25/11/2026',
      horario: '09:00',
    });
  });

  it('remarcação antiga de reserva migrada (vários itens na revisão): profissionais distintos', () => {
    const migrada = [
      item('2026-11-25T12:00:00Z', 'Corte', 'Marina', { revisao: 1 }),
      item('2026-11-25T12:30:00Z', 'Escova', 'Marina', { revisao: 1 }),
    ];
    expect(montarParametros('remarcacao', dados(migrada, 1))).toMatchObject({
      servicos: 'Corte e Escova',
      profissional: 'Marina',
      horario: '09:00',
    });
  });

  it.each(['remarcacao', 'cancelamento'] as const)('%s sem item na revisão → RangeError', (tipo) => {
    expect(() => montarParametros(tipo, dados(itens, 9))).toThrow(RangeError);
  });
});

describe('montarParametrosConvite', () => {
  it('leva salao e link', () => {
    expect(montarParametrosConvite('Studio Terra', 'https://x/avaliar/abc')).toEqual({
      salao: 'Studio Terra',
      link: 'https://x/avaliar/abc',
    });
  });
});
