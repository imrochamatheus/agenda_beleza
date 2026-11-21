import { describe, expect, it } from 'vitest';

import { montarSemana } from '@/server/semana/montagem';
import { instanteDeHoraLocal } from '@/server/tempo/fuso';

import { detectarMotivos } from './encaixe';

// D-029 CA-1, CA-6, CA-7, CA-8, CA-18: detecção pura dos motivos, sem banco, em minutos de parede.
const SP = 'America/Sao_Paulo';
const TERCA = { ano: 2026, mes: 12, dia: 1 }; // dia da semana 2
const SABADO = { ano: 2026, mes: 12, dia: 5 };

const hm = (h: number, m = 0) => h * 60 + m;
const em = (d: { ano: number; mes: number; dia: number }, h: number, m = 0, fuso = SP) => instanteDeHoraLocal(d, hm(h, m), fuso);
const jornada = (inicio = hm(9), fim = hm(18)) =>
  montarSemana([0, 1, 2, 3, 4, 5, 6].map((diaSemana) => ({ diaSemana, inicioMin: inicio, fimMin: fim })));

function motivos(inicio: Date, fim: Date, extra: Partial<Parameters<typeof detectarMotivos>[0]> = {}) {
  return detectarMotivos({ inicio, fim, fuso: SP, jornada: jornada(), bloqueios: [], funcionamento: { definido: false }, ...extra });
}

describe('detectarMotivos', () => {
  it('dentro da jornada, sem bloqueio e funcionamento não informado: nenhum motivo', () => {
    expect(motivos(em(TERCA, 10), em(TERCA, 10, 30))).toEqual([]);
    expect(motivos(em(TERCA, 17, 30), em(TERCA, 18))).toEqual([]);
  });

  it('CA-1: termina depois do fim da jornada ou começa antes: fora_da_jornada', () => {
    expect(motivos(em(TERCA, 18, 30), em(TERCA, 19))).toEqual(['fora_da_jornada']);
    expect(motivos(em(TERCA, 17, 45), em(TERCA, 18, 15))).toEqual(['fora_da_jornada']);
    expect(motivos(em(TERCA, 8, 30), em(TERCA, 9, 30))).toEqual(['fora_da_jornada']);
  });

  it('sem jornada no dia: fora_da_jornada; o atendimento precisa caber em UM intervalo', () => {
    expect(motivos(em(TERCA, 10), em(TERCA, 11), { jornada: montarSemana([]) })).toEqual(['fora_da_jornada']);
    const partida = montarSemana([
      { diaSemana: 2, inicioMin: hm(9), fimMin: hm(12) },
      { diaSemana: 2, inicioMin: hm(13), fimMin: hm(18) },
    ]);
    expect(motivos(em(TERCA, 11, 30), em(TERCA, 12, 30), { jornada: partida })).toEqual(['fora_da_jornada']);
    expect(motivos(em(TERCA, 13), em(TERCA, 14), { jornada: partida })).toEqual([]);
  });

  it('CA-6: bloqueio por interseção semiaberta (encostar não bloqueia)', () => {
    const b = [{ inicio: em(TERCA, 14), fim: em(TERCA, 15) }];
    expect(motivos(em(TERCA, 14), em(TERCA, 14, 30), { bloqueios: b })).toEqual(['bloqueado']);
    expect(motivos(em(TERCA, 14, 45), em(TERCA, 15, 15), { bloqueios: b })).toEqual(['bloqueado']);
    expect(motivos(em(TERCA, 13, 30), em(TERCA, 14), { bloqueios: b })).toEqual([]);
    expect(motivos(em(TERCA, 15), em(TERCA, 15, 30), { bloqueios: b })).toEqual([]);
  });

  it('CA-7: funcionamento definido; dia vazio é fechado e definido:false nunca é motivo', () => {
    const semSabado = montarSemana([0, 1, 2, 3, 4, 5].map((diaSemana) => ({ diaSemana, inicioMin: hm(8), fimMin: hm(20) })));
    const f = { definido: true as const, semana: semSabado };
    expect(motivos(em(SABADO, 10), em(SABADO, 11), { funcionamento: f })).toEqual(['fora_do_funcionamento']);
    expect(motivos(em(TERCA, 10), em(TERCA, 11), { funcionamento: f })).toEqual([]);
    expect(motivos(em(SABADO, 10), em(SABADO, 11), { funcionamento: { definido: false } })).toEqual([]);
  });

  it('os motivos coexistem, na ordem fixa', () => {
    const f = { definido: true as const, semana: montarSemana([]) };
    const b = [{ inicio: em(TERCA, 18), fim: em(TERCA, 20) }];
    expect(motivos(em(TERCA, 18, 30), em(TERCA, 19), { funcionamento: f, bloqueios: b })).toEqual([
      'fora_da_jornada',
      'bloqueado',
      'fora_do_funcionamento',
    ]);
  });

  it('atravessar a meia-noite local é fora da jornada, mesmo com o dia seguinte aberto', () => {
    const toda = jornada(0, 1440);
    expect(motivos(em(TERCA, 23, 30), instanteDeHoraLocal({ ano: 2026, mes: 12, dia: 2 }, 30, SP), { jornada: toda })).toEqual(['fora_da_jornada']);
  });

  it('terminar exatamente à meia-noite cabe em um intervalo que vai até 24:00', () => {
    const toda = jornada(0, 1440);
    expect(motivos(em(TERCA, 23, 30), instanteDeHoraLocal({ ano: 2026, mes: 12, dia: 2 }, 0, SP), { jornada: toda })).toEqual([]);
    expect(motivos(em(TERCA, 23, 30), instanteDeHoraLocal({ ano: 2026, mes: 12, dia: 2 }, 0, SP))).toEqual(['fora_da_jornada']);
  });

  it('CA-18: o resultado é o do fuso do salão, não o do processo (UTC e fuso diferente)', () => {
    // 10:00 em Manaus (UTC-4) é 14:00Z; em São Paulo seria 11:00. A jornada 09-18 vale no fuso do salão.
    const manaus = 'America/Manaus';
    const ini = instanteDeHoraLocal(TERCA, hm(10), manaus);
    expect(motivos(ini, new Date(ini.getTime() + 30 * 60_000), { fuso: manaus })).toEqual([]);
    const tarde = instanteDeHoraLocal(TERCA, hm(18, 30), manaus);
    expect(motivos(tarde, new Date(tarde.getTime() + 30 * 60_000), { fuso: manaus })).toEqual(['fora_da_jornada']);
  });

  it('CA-18: hora local inexistente (horário de verão) usa o instante da transição', () => {
    // Santiago: 2026-09-06 00:00 não existe (salto para 01:00 local).
    const fuso = 'America/Santiago';
    const dia = { ano: 2026, mes: 9, dia: 6 };
    const ini = instanteDeHoraLocal(dia, 0, fuso);
    const fim = new Date(ini.getTime() + 30 * 60_000);
    expect(motivos(ini, fim, { fuso, jornada: jornada(hm(1), hm(18)) })).toEqual([]);
    expect(motivos(ini, fim, { fuso, jornada: jornada(hm(2), hm(18)) })).toEqual(['fora_da_jornada']);
  });
});
