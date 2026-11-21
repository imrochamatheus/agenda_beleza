import { describe, expect, it } from 'vitest';

import { montarParametros, montarParametrosConvite } from './parametros';

// 2026-11-21T02:30:00Z = 20/11/2026 23:30 em São Paulo (dia diferente do UTC)
const INICIO = new Date('2026-11-21T02:30:00Z');
const dados = (o: Partial<Parameters<typeof montarParametros>[1]> = {}) => ({
  salaoNome: 'Studio Terra',
  fuso: 'America/Sao_Paulo',
  inicio: INICIO,
  servicos: ['Corte', 'Barba', 'Hidratação'],
  profissionalNome: 'Marina',
  ...o,
});

describe('montarParametros (RN-11, A-12)', () => {
  it.each(['confirmacao', 'remarcacao'] as const)('%s leva salao, servicos, profissional, data e horario', (tipo) => {
    expect(montarParametros(tipo, dados())).toEqual({
      salao: 'Studio Terra',
      servicos: 'Corte, Barba e Hidratação',
      profissional: 'Marina',
      data: '20/11/2026',
      horario: '23:30',
    });
  });

  it('cancelamento leva salao, servicos, data e horario (sem profissional)', () => {
    expect(montarParametros('cancelamento', dados())).toEqual({
      salao: 'Studio Terra',
      servicos: 'Corte, Barba e Hidratação',
      data: '20/11/2026',
      horario: '23:30',
    });
  });

  it('usa o fuso do salão: o mesmo instante em UTC cai no dia seguinte', () => {
    expect(montarParametros('confirmacao', dados({ fuso: 'UTC' }))).toMatchObject({ data: '21/11/2026', horario: '02:30' });
  });

  it('profissional ausente vira texto vazio e serviço único não leva "e"', () => {
    expect(montarParametros('confirmacao', dados({ profissionalNome: null, servicos: ['Corte'] }))).toMatchObject({
      profissional: '',
      servicos: 'Corte',
    });
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
