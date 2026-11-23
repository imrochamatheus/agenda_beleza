import { describe, expect, it } from 'vitest';

import type { BloqueioDTO } from '@/server/repos/tipos';

import { opcoesDeAlvo, paraAviso, paraItem, valoresDeEdicao } from './apresentacao';

// D-016 T-4: apresentação (CA-3, CA-5, CA-14, CA-15, CA-17, R-2).

const SP = 'America/Sao_Paulo';
const ANA = '11111111-1111-4111-8111-111111111111';
const BIA = '22222222-2222-4222-8222-222222222222';

function dto(d: Partial<BloqueioDTO> = {}): BloqueioDTO {
  return {
    id: 'b1',
    profissionalId: ANA,
    inicio: new Date('2026-12-25T17:00:00Z'),
    fim: new Date('2026-12-25T19:00:00Z'),
    motivo: 'Dentista',
    profissional: { id: ANA, nome: 'Ana', ativo: true },
    ...d,
  };
}
const salao = (d: Partial<BloqueioDTO> = {}) =>
  dto({ profissionalId: null, profissional: null, inicio: new Date('2026-12-25T03:00:00Z'), fim: new Date('2026-12-26T03:00:00Z'), motivo: null, ...d });

const GESTOR = { papel: 'gestor', profissionalId: null } as const;
const PROF_ANA = { papel: 'profissional', profissionalId: ANA } as const;
const PROF_BIA = { papel: 'profissional', profissionalId: BIA } as const;

describe('paraItem', () => {
  it('bloqueio de profissional com horário: período com data e hora, editável pelo gestor e pela dona (CA-14)', () => {
    expect(paraItem(dto(), SP, GESTOR)).toEqual({
      id: 'b1',
      alvo: { tipo: 'profissional', id: ANA, nome: 'Ana', ativo: true },
      inicio: '2026-12-25T17:00:00.000Z',
      fim: '2026-12-25T19:00:00.000Z',
      diaInteiro: false,
      periodo: '25/12/2026 14:00 a 25/12/2026 16:00',
      motivo: 'Dentista',
      editavel: true,
    });
    expect(paraItem(dto(), SP, PROF_ANA).editavel).toBe(true);
    expect(paraItem(dto(), SP, PROF_BIA).editavel).toBe(false);
  });

  it('bloqueio do salão de dia inteiro: alvo salão, "(dia inteiro)", somente leitura para o profissional (CA-3, D-10)', () => {
    const item = paraItem(salao(), SP, PROF_ANA);
    expect(item).toMatchObject({ alvo: { tipo: 'salao' }, diaInteiro: true, periodo: '25/12/2026 (dia inteiro)', editavel: false });
    expect(paraItem(salao(), SP, GESTOR).editavel).toBe(true);
  });

  it('profissional inativo marcado (CA-15) e fuso trocado só muda a exibição (CA-17)', () => {
    const item = paraItem(dto({ profissional: { id: ANA, nome: 'Ana', ativo: false } }), 'America/Manaus', GESTOR);
    expect(item.alvo).toEqual({ tipo: 'profissional', id: ANA, nome: 'Ana', ativo: false });
    expect(item.periodo).toBe('25/12/2026 13:00 a 25/12/2026 15:00');
  });

  it('bloqueio de profissional sem o objeto profissional (defensivo): nome vazio e ativo', () => {
    expect(paraItem(dto({ profissional: null }), SP, GESTOR).alvo).toEqual({ tipo: 'profissional', id: ANA, nome: '', ativo: true });
  });
});

describe('paraAviso', () => {
  it('horários no fuso e "cliente removida" para a anonimizada; total preservado', () => {
    const aviso = paraAviso(
      {
        total: 5,
        reservas: [
          { id: 'r1', itemId: 'i1', profissionalId: ANA, profissionalNome: 'Ana', inicio: new Date('2026-12-25T17:00:00Z'), fim: new Date('2026-12-25T18:00:00Z'), clienteNome: 'Joana' },
          { id: 'r2', itemId: 'i2', profissionalId: BIA, profissionalNome: 'Bia', inicio: new Date('2026-12-26T01:00:00Z'), fim: new Date('2026-12-26T02:00:00Z'), clienteNome: null },
        ],
      },
      SP,
    );
    expect(aviso).toEqual({
      total: 5,
      reservas: [
        { id: 'r1', itemId: 'i1', profissionalNome: 'Ana', inicioLocal: '25/12/2026 14:00', fimLocal: '25/12/2026 15:00', cliente: 'Joana' },
        { id: 'r2', itemId: 'i2', profissionalNome: 'Bia', inicioLocal: '25/12/2026 22:00', fimLocal: '25/12/2026 23:00', cliente: 'cliente removida' },
      ],
    });
  });
  it('D-050 RN-38: dois itens da mesma reserva viram duas linhas, cada uma com o período do item', () => {
    const aviso = paraAviso(
      {
        total: 2,
        reservas: [
          { id: 'r1', itemId: 'i1', profissionalId: ANA, profissionalNome: 'Ana', inicio: new Date('2026-12-25T17:00:00Z'), fim: new Date('2026-12-25T18:00:00Z'), clienteNome: 'Joana' },
          { id: 'r1', itemId: 'i2', profissionalId: BIA, profissionalNome: 'Bia', inicio: new Date('2026-12-25T18:00:00Z'), fim: new Date('2026-12-25T18:30:00Z'), clienteNome: 'Joana' },
        ],
      },
      SP,
    );
    expect(aviso.reservas.map((x) => [x.id, x.itemId, x.profissionalNome, x.inicioLocal, x.fimLocal])).toEqual([
      ['r1', 'i1', 'Ana', '25/12/2026 14:00', '25/12/2026 15:00'],
      ['r1', 'i2', 'Bia', '25/12/2026 15:00', '25/12/2026 15:30'],
    ]);
  });
});

describe('valoresDeEdicao (D-23, R-2)', () => {
  it('com horário → modo horario com data e hora nas duas pontas', () => {
    expect(valoresDeEdicao(dto({ inicio: new Date('2026-12-26T01:00:00Z'), fim: new Date('2026-12-26T05:00:00Z') }), SP)).toEqual({
      alvo: ANA,
      modo: 'horario',
      dataInicio: '25/12/2026',
      horaInicio: '22:00',
      dataFim: '26/12/2026',
      horaFim: '02:00',
      motivo: 'Dentista',
    });
  });

  it('dia inteiro → modo dia_inteiro com a última data inclusiva, horas vazias; motivo null → ""', () => {
    expect(valoresDeEdicao(salao({ fim: new Date('2026-12-28T03:00:00Z') }), SP)).toEqual({
      alvo: 'salao',
      modo: 'dia_inteiro',
      dataInicio: '25/12/2026',
      horaInicio: '',
      dataFim: '27/12/2026',
      horaFim: '',
      motivo: '',
    });
  });

  it('dias de 23 h e 25 h (horário de verão histórico)', () => {
    expect(valoresDeEdicao(salao({ inicio: new Date('2018-11-04T03:00:00Z'), fim: new Date('2018-11-05T02:00:00Z') }), SP)).toMatchObject({
      modo: 'dia_inteiro',
      dataInicio: '04/11/2018',
      dataFim: '04/11/2018',
    });
    expect(valoresDeEdicao(salao({ inicio: new Date('2018-02-17T02:00:00Z'), fim: new Date('2018-02-18T03:00:00Z') }), SP)).toMatchObject({
      modo: 'dia_inteiro',
      dataInicio: '17/02/2018',
      dataFim: '17/02/2018',
    });
  });
});

describe('opcoesDeAlvo', () => {
  it('"Salão inteiro" primeiro; inativo marcado', () => {
    expect(
      opcoesDeAlvo([
        { id: ANA, nome: 'Ana', ativo: true },
        { id: BIA, nome: 'Bia', ativo: false },
      ]),
    ).toEqual([
      { valor: 'salao', rotulo: 'Salão inteiro' },
      { valor: ANA, rotulo: 'Ana' },
      { valor: BIA, rotulo: 'Bia (inativo)' },
    ]);
    expect(opcoesDeAlvo([])).toEqual([{ valor: 'salao', rotulo: 'Salão inteiro' }]);
  });
});
