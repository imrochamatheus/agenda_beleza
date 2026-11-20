import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { MENSAGENS_INTERVALO } from '@/server/semana/tipos';

import { MENSAGENS_FUNCIONAMENTO, MODOS_FUNCIONAMENTO } from './funcionamento-tipos';
import { validarFuncionamento } from './funcionamento-validacao';

// D-020 T-4: modos (RN-14, A-12), CA-3 via validarDias e CA-8 (não informar ignora as linhas).

const M = MENSAGENS_FUNCIONAMENTO;

function dias(d: Partial<Record<number, [string, string][]>> = {}) {
  return [0, 1, 2, 3, 4, 5, 6].map((diaSemana) => ({
    diaSemana,
    intervalos: (d[diaSemana] ?? []).map(([inicio, fim]) => ({ inicio, fim })),
  }));
}

describe('validarFuncionamento', () => {
  it('modos aceitos', () => {
    expect(MODOS_FUNCIONAMENTO).toEqual(['nao_informar', 'informar']);
  });

  it.each([null, 'informar', 42, []])('entrada não objeto (%s) → formulario', (e) => {
    expect(validarFuncionamento(e)).toEqual({ ok: false, erros: { formulario: M.formulario } });
  });

  it.each([undefined, '', 'sim', 1, ['informar']])('modo ausente ou inválido (%s) → erro de campo modo (A-12)', (modo) => {
    expect(validarFuncionamento({ modo, dias: dias() })).toEqual({ ok: false, erros: { modo: M.modo } });
  });

  it('CA-8: nao_informar ignora os dias, mesmo inválidos ou ausentes', () => {
    expect(validarFuncionamento({ modo: 'nao_informar', dias: dias({ 1: [['22:00', '02:00']] }) })).toEqual({ ok: true, modo: 'nao_informar' });
    expect(validarFuncionamento({ modo: 'nao_informar' })).toEqual({ ok: true, modo: 'nao_informar' });
    expect(validarFuncionamento({ modo: 'nao_informar', dias: 'lixo' })).toEqual({ ok: true, modo: 'nao_informar' });
  });

  it('CA-7: informar com todos os dias vazios é válido (fechado)', () => {
    expect(validarFuncionamento({ modo: 'informar', dias: dias() })).toEqual({ ok: true, modo: 'informar', intervalos: [] });
  });

  it('CA-3: terça 09:00–12:00 e 12:00–13:00 → uma linha; 22:00–24:00 aceito', () => {
    expect(validarFuncionamento({ modo: 'informar', dias: dias({ 2: [['09:00', '12:00'], ['12:00', '13:00']], 5: [['22:00', '24:00']] }) })).toEqual({
      ok: true,
      modo: 'informar',
      intervalos: [
        { diaSemana: 2, inicioMin: 540, fimMin: 780 },
        { diaSemana: 5, inicioMin: 1320, fimMin: 1440 },
      ],
    });
  });

  it('CA-3: sobreposição, 09:07, meia-noite, fim = início, início 24:00 e 7 intervalos → erros por dia', () => {
    const sete: [string, string][] = [8, 10, 12, 14, 16, 18, 20].map((h) => [`${h}:00`, `${h}:30`]);
    const r = validarFuncionamento({
      modo: 'informar',
      dias: dias({
        1: [['09:00', '12:00'], ['11:00', '14:00']],
        2: [['09:07', '12:00']],
        3: [['22:00', '02:00']],
        4: [['10:00', '10:00']],
        5: [['24:00', '24:00']],
        6: sete,
      }),
    });
    expect(r).toEqual({
      ok: false,
      erros: {
        dias: {
          1: { intervalos: { 0: { intervalo: M.sobreposicao }, 1: { intervalo: M.sobreposicao } } },
          2: { intervalos: { 0: { inicio: M.granularidade } } },
          3: { intervalos: { 0: { intervalo: M.ordem } } },
          4: { intervalos: { 0: { intervalo: M.ordem } } },
          5: { intervalos: { 0: { inicio: M.inicio24 } } },
          6: { dia: M.limite },
        },
      },
    });
  });

  it('informar com forma inválida (dias ausentes, mais de 20 linhas) → formulario', () => {
    expect(validarFuncionamento({ modo: 'informar' })).toEqual({ ok: false, erros: { formulario: M.formulario } });
    const muitas = dias();
    muitas[1].intervalos = Array.from({ length: 21 }, () => ({ inicio: '', fim: '' }));
    expect(validarFuncionamento({ modo: 'informar', dias: muitas })).toEqual({ ok: false, erros: { formulario: M.formulario } });
  });

  it('MENSAGENS_FUNCIONAMENTO contém as mensagens por intervalo com os mesmos textos', () => {
    for (const [k, v] of Object.entries(MENSAGENS_INTERVALO)) expect(M[k as keyof typeof M], k).toBe(v);
  });

  it('funcionamento-tipos.ts só importa de @/server/semana/tipos', () => {
    const texto = readFileSync(fileURLToPath(new URL('./funcionamento-tipos.ts', import.meta.url)), 'utf8');
    const imports = [...texto.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    expect(new Set(imports)).toEqual(new Set(['@/server/semana/tipos']));
  });
});
