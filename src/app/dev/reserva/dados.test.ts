import { describe, expect, it } from 'vitest';

import { lerPasso } from '@/server/reserva-publica/passos';
import type { ParametrosBrutos } from '@/server/reserva-publica/passos';
import { partesLocais } from '@/server/tempo/fuso';

import { EQUIPE_DEMO, FUSO_DEMO, JANELA_DEMO, SERVICOS_DEMO, visaoDemonstracao } from './dados';

// 2026-12-01 é terça-feira; 12:00 UTC = 09:00 em São Paulo.
const AGORA = new Date('2026-12-01T12:00:00Z');
const HOJE = partesLocais(AGORA, FUSO_DEMO).data;
const [CORTE, ESCOVA, COLORACAO] = SERVICOS_DEMO.map((s) => s.id);
const [ANA, BIA] = EQUIPE_DEMO.map((p) => p.id);
const ver = (params: ParametrosBrutos) => visaoDemonstracao(lerPasso(params, { hoje: HOJE, janelaDias: JANELA_DEMO }), HOJE, AGORA);

describe('visaoDemonstracao', () => {
  it('sem parâmetros: serviços; serviço desconhecido volta com aviso', () => {
    expect(ver({})).toEqual({ passo: 'servicos', aviso: null });
    expect(ver({ s: '99999999-9999-4999-8999-999999999999' })).toEqual({ passo: 'servicos', aviso: 'servico_indisponivel' });
  });

  it('profissionais: Bia não faz coloração; quem faz tudo é só a Ana', () => {
    const um = ver({ s: ESCOVA });
    expect(um.passo === 'profissional' && um.profissionais.map((p) => p.nome)).toEqual(['Ana', 'Bia']);
    const dois = ver({ s: [CORTE, COLORACAO] });
    expect(dois.passo === 'profissional' && dois.profissionais.map((p) => p.nome)).toEqual(['Ana']);
    expect(dois.passo === 'profissional' && dois.selecao).toMatchObject({ duracaoTotalMin: 180, precoTotalCentavos: 27000 });
  });

  it('profissional que não faz o serviço volta ao profissional com aviso', () => {
    expect(ver({ s: COLORACAO, p: BIA })).toMatchObject({ passo: 'profissional', aviso: 'profissional_indisponivel' });
  });

  it('dias: 14 por página, domingos sem horário, navegação até o fim da janela', () => {
    const v = ver({ s: ESCOVA, p: 'qualquer' });
    if (v.passo !== 'data') throw new Error('passo inesperado');
    expect(v.dias).toHaveLength(14);
    expect(v.dias.find((d) => d.data === '2026-12-06')?.temHorarios).toBe(false);
    expect(v.dias.find((d) => d.data === '2026-12-02')?.temHorarios).toBe(true);
    expect([v.anterior, v.proxima]).toEqual([null, '2026-12-15']);
    const fim = ver({ s: ESCOVA, p: 'qualquer', de: '2027-01-20' });
    expect(fim.passo === 'data' && [fim.dias.at(-1)?.data, fim.proxima, fim.anterior]).toEqual(['2027-01-30', null, '2027-01-06']);
  });

  it('horários do dia respeitam a antecedência (hoje) e a duração; "qualquer" une Ana e Bia', () => {
    const hoje = ver({ s: ESCOVA, p: 'qualquer', data: '2026-12-01' });
    if (hoje.passo !== 'horario') throw new Error('passo inesperado');
    // Agora 09:00 + 2 h: o primeiro horário é 11:00 (14:00Z).
    expect(hoje.horarios[0]).toBe('2026-12-01T14:00:00.000Z');
    const ana = ver({ s: ESCOVA, p: ANA, data: '2026-12-02' });
    const bia = ver({ s: ESCOVA, p: BIA, data: '2026-12-02' });
    const todos = ver({ s: ESCOVA, p: 'qualquer', data: '2026-12-02' });
    if (ana.passo !== 'horario' || bia.passo !== 'horario' || todos.passo !== 'horario') throw new Error('passo inesperado');
    expect(todos.horarios).toEqual(ana.horarios);
    expect(bia.horarios[0]).toBe('2026-12-02T13:00:00.000Z');
    expect(ana.horarios.at(-1)).toBe('2026-12-02T20:30:00.000Z');
  });

  it('dados: o primeiro por nome leva o horário; horário fora da grade volta ao horário', () => {
    const as10 = ver({ s: ESCOVA, p: 'qualquer', data: '2026-12-02', h: '2026-12-02T13:00:00.000Z' });
    expect(as10).toMatchObject({ passo: 'dados', profissional: { nome: 'Ana' }, inicioIso: '2026-12-02T13:00:00.000Z' });
    const fora = ver({ s: ESCOVA, p: 'qualquer', data: '2026-12-02', h: '2026-12-02T03:00:00.000Z' });
    expect(fora).toMatchObject({ passo: 'horario', aviso: 'horario_indisponivel' });
  });
});
