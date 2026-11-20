import { describe, expect, it } from 'vitest';

import { MENSAGENS_BLOQUEIO } from './tipos';
import { lerData, lerHora, lerMotivo, resolverPeriodo } from './validacao';

// D-016 T-4: leitura dos campos e resolução do período (CA-5 conversão, CA-7, CA-8, CA-9, CA-12, CA-16).

const M = MENSAGENS_BLOQUEIO;
const SP = 'America/Sao_Paulo';
const AGORA = new Date('2026-12-01T12:00:00Z');
const CRIAR = { edicao: false };
const EDITAR = { edicao: true };

const horario = (dataInicio: string, horaInicio: string, dataFim: string, horaFim: string, extra: Record<string, unknown> = {}) => ({
  modo: 'horario',
  dataInicio,
  horaInicio,
  dataFim,
  horaFim,
  ...extra,
});
const dia = (dataInicio: string, dataFim = dataInicio, extra: Record<string, unknown> = {}) => ({
  modo: 'dia_inteiro',
  dataInicio,
  dataFim,
  ...extra,
});

function ok(e: unknown, opcoes = CRIAR, agora = AGORA, fuso = SP) {
  const r = resolverPeriodo(e, fuso, agora, opcoes);
  if (!r.ok) throw new Error(`esperava ok, veio ${JSON.stringify(r.erros)}`);
  return { ...r, inicio: r.inicio.toISOString(), fim: r.fim.toISOString() };
}
function erros(e: unknown, opcoes = CRIAR, agora = AGORA) {
  const r = resolverPeriodo(e, SP, agora, opcoes);
  if (r.ok) throw new Error('esperava erro');
  return r.erros;
}

describe('lerData', () => {
  it('aceita dd/mm/aaaa com espaços; formato errado → data; inexistente → dataInexistente', () => {
    expect(lerData(' 25/12/2026 ')).toEqual({ ok: true, data: { ano: 2026, mes: 12, dia: 25 } });
    expect(lerData('29/02/2028')).toEqual({ ok: true, data: { ano: 2028, mes: 2, dia: 29 } });
    for (const v of ['', '2026-12-25', '25/12/26', '5/12/2026', 'x', 42, undefined, '1'.repeat(30)]) {
      expect(lerData(v)).toEqual({ ok: false, erro: 'data' });
    }
    for (const v of ['31/02/2026', '29/02/2027', '00/12/2026', '25/13/2026', '01/01/1800']) {
      expect(lerData(v)).toEqual({ ok: false, erro: 'dataInexistente' });
    }
  });
});

describe('lerHora', () => {
  it('H:MM e HH:MM de 00:00 a 23:55; 24:00/25:00/14:60/9h → hora; 14:07 → granularidade', () => {
    expect(lerHora('9:00')).toEqual({ ok: true, min: 540 });
    expect(lerHora(' 23:55 ')).toEqual({ ok: true, min: 1435 });
    expect(lerHora('00:00')).toEqual({ ok: true, min: 0 });
    for (const v of ['24:00', '25:00', '14:60', '9h', '', '14', '14:0', 7, null, '1'.repeat(30)]) {
      expect(lerHora(v)).toEqual({ ok: false, erro: 'hora' });
    }
    expect(lerHora('14:07')).toEqual({ ok: false, erro: 'granularidade' });
  });
});

describe('lerMotivo (CA-16)', () => {
  it('apara; vazio/ausente → null; 200 aceito; 201 recusado; não-texto recusado', () => {
    expect(lerMotivo('  Feriado  ')).toEqual({ ok: true, motivo: 'Feriado' });
    expect(lerMotivo('')).toEqual({ ok: true, motivo: null });
    expect(lerMotivo('   ')).toEqual({ ok: true, motivo: null });
    expect(lerMotivo(undefined)).toEqual({ ok: true, motivo: null });
    expect(lerMotivo('a'.repeat(200))).toEqual({ ok: true, motivo: 'a'.repeat(200) });
    expect(lerMotivo('a'.repeat(201))).toEqual({ ok: false });
    expect(lerMotivo(5)).toEqual({ ok: false });
  });
});

describe('resolverPeriodo: conversão (CA-3, CA-5)', () => {
  it('com horário atravessando a meia-noite em São Paulo', () => {
    expect(ok(horario('25/12/2026', '22:00', '26/12/2026', '02:00'))).toMatchObject({
      inicio: '2026-12-26T01:00:00.000Z',
      fim: '2026-12-26T05:00:00.000Z',
      motivo: null,
    });
  });

  it('Manaus 10:00–12:00 → [14:00Z, 16:00Z)', () => {
    expect(ok(horario('25/12/2026', '10:00', '25/12/2026', '12:00'), CRIAR, AGORA, 'America/Manaus')).toMatchObject({
      inicio: '2026-12-25T14:00:00.000Z',
      fim: '2026-12-25T16:00:00.000Z',
    });
  });

  it('dia inteiro: uma data e várias; as horas são ignoradas, mesmo inválidas', () => {
    expect(ok(dia('25/12/2026'))).toMatchObject({ inicio: '2026-12-25T03:00:00.000Z', fim: '2026-12-26T03:00:00.000Z' });
    expect(ok(dia('24/12/2026', '26/12/2026', { horaInicio: '9h', horaFim: '99:99' }))).toMatchObject({
      inicio: '2026-12-24T03:00:00.000Z',
      fim: '2026-12-27T03:00:00.000Z',
    });
  });

  it('devolve o alvo e o motivo aparado; o id só na edição', () => {
    expect(ok(dia('25/12/2026', '25/12/2026', { alvo: 'salao', motivo: '  Natal ' }))).toMatchObject({ alvo: 'salao', motivo: 'Natal', id: undefined });
    expect(ok(dia('25/12/2026', '25/12/2026', { id: 'abc' }), EDITAR)).toMatchObject({ id: 'abc', alvo: undefined });
  });
});

describe('resolverPeriodo: erros de campo (CA-7, CA-16)', () => {
  it('fim igual ou anterior ao início → periodo = ordem', () => {
    expect(erros(horario('25/12/2026', '14:00', '25/12/2026', '14:00'))).toEqual({ periodo: M.ordem });
    expect(erros(horario('25/12/2026', '14:00', '24/12/2026', '16:00'))).toEqual({ periodo: M.ordem });
  });

  it('dia inteiro com data final anterior → dataFim = ordemDias', () => {
    expect(erros(dia('26/12/2026', '25/12/2026'))).toEqual({ dataFim: M.ordemDias });
  });

  it('formatos, granularidade, data inexistente e vazios acumulam por campo', () => {
    expect(erros(horario('31/02/2026', '14:07', '', '25:00', { motivo: 'x'.repeat(201) }))).toEqual({
      dataInicio: M.dataInexistente,
      horaInicio: M.granularidade,
      dataFim: M.data,
      horaFim: M.hora,
      motivo: M.motivo,
    });
    expect(erros(horario('25/12/2026', '9h', '25/12/2026', '14:60'))).toEqual({ horaInicio: M.hora, horaFim: M.hora });
    expect(erros({ modo: 'horario', dataInicio: '25/12/2026', dataFim: '25/12/2026' })).toEqual({ horaInicio: M.hora, horaFim: M.hora });
  });

  it('modo desconhecido, vazio ou ausente → só erros.modo', () => {
    for (const modo of ['semana', '', undefined]) {
      expect(erros({ modo, dataInicio: 'x', dataFim: 'y' })).toEqual({ modo: M.modo });
    }
  });

  it('forma: chave extra, tipo errado ou não-objeto → só formulario', () => {
    expect(erros(dia('25/12/2026', '25/12/2026', { salaoId: 'x' }))).toEqual({ formulario: M.formulario });
    expect(erros(dia('25/12/2026', '25/12/2026', { profissionalId: 'x' }))).toEqual({ formulario: M.formulario });
    expect(erros({ ...dia('25/12/2026'), dataInicio: 25 })).toEqual({ formulario: M.formulario });
    expect(erros({ ...dia('25/12/2026'), alvo: 7 })).toEqual({ formulario: M.formulario });
    expect(erros(null)).toEqual({ formulario: M.formulario });
    expect(erros('x')).toEqual({ formulario: M.formulario });
    // Na criação, `id` é chave extra.
    expect(erros(dia('25/12/2026', '25/12/2026', { id: 'x' }))).toEqual({ formulario: M.formulario });
  });

  it('CA-12/D-21: na edição, alvo, profissionalId ou salaoId → formulario', () => {
    for (const chave of ['alvo', 'profissionalId', 'salaoId']) {
      expect(erros(dia('25/12/2026', '25/12/2026', { id: 'abc', [chave]: 'x' }), EDITAR)).toEqual({ formulario: M.formulario });
    }
  });
});

describe('resolverPeriodo: passado e limites (CA-8, CA-9)', () => {
  it('CA-8: fim <= agora → passado; início no passado com fim futuro → aceito', () => {
    const agora = new Date('2026-12-25T13:30:00Z'); // 10:30 em São Paulo
    expect(erros(horario('25/12/2026', '08:00', '25/12/2026', '10:30'), CRIAR, agora)).toEqual({ periodo: M.passado });
    expect(erros(horario('24/12/2026', '08:00', '24/12/2026', '10:00'), CRIAR, agora)).toEqual({ periodo: M.passado });
    expect(ok(dia('25/12/2026'), CRIAR, agora)).toMatchObject({ inicio: '2026-12-25T03:00:00.000Z' });
    expect(ok(horario('25/12/2026', '08:00', '25/12/2026', '10:35'), CRIAR, agora)).toMatchObject({ fim: '2026-12-25T13:35:00.000Z' });
    expect(erros(dia('24/12/2026'), EDITAR, agora)).toEqual({ periodo: M.passado });
  });

  it('CA-9: 366 dias exatos com horário aceito; 5 minutos a mais recusado', () => {
    // 2027 não é bissexto: 02/12/2026 10:00 → 03/12/2027 10:00 = 366 × 24 h.
    expect(ok(horario('02/12/2026', '10:00', '03/12/2027', '10:00'))).toMatchObject({ inicio: '2026-12-02T13:00:00.000Z' });
    expect(erros(horario('02/12/2026', '10:00', '03/12/2027', '10:05'))).toEqual({ periodo: M.duracao });
  });

  it('CA-9: 366 datas no dia inteiro aceito; 367 recusado', () => {
    expect(ok(dia('02/12/2026', '02/12/2027'))).toMatchObject({ inicio: '2026-12-02T03:00:00.000Z', fim: '2027-12-03T03:00:00.000Z' });
    expect(erros(dia('02/12/2026', '03/12/2027'))).toEqual({ periodo: M.duracao });
  });

  it('CA-9: início até 730 × 24 h à frente aceito; além disso recusado', () => {
    // AGORA = 01/12/2026 09:00 local; + 730 × 24 h = 30/11/2028 09:00 local (2028 é bissexto).
    expect(ok(horario('30/11/2028', '09:00', '30/11/2028', '10:00'))).toMatchObject({ inicio: '2028-11-30T12:00:00.000Z' });
    expect(erros(horario('30/11/2028', '09:05', '30/11/2028', '10:00'))).toEqual({ periodo: M.antecedencia });
  });
});
