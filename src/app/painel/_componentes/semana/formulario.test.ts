import { describe, expect, it } from 'vitest';

import { montarSemana } from '@/server/semana/montagem';

import {
  idDoCampo,
  idDoErroDaLinha,
  idDoErroDoDia,
  itensDoResumo,
  lerSemanaDoFormulario,
  nomeDoCampo,
  resumoDoDia,
  textoDasPausas,
  textoDosIntervalos,
  valoresDaSemana,
} from './formulario';

// D-020 T-7: editor de semana compartilhado (prefixo e texto do dia vazio parametrizados).

const SEMANA = montarSemana([
  { diaSemana: 1, inicioMin: 540, fimMin: 720 },
  { diaSemana: 1, inicioMin: 780, fimMin: 1080 },
  { diaSemana: 5, inicioMin: 1320, fimMin: 1440 },
]);

describe('ids e nomes', () => {
  it('nomes sem prefixo; ids com prefixo', () => {
    expect(nomeDoCampo(1, 0, 'inicio')).toBe('inicio-1-0');
    expect(idDoCampo('funcionamento', 1, 2, 'fim')).toBe('funcionamento-1-2-fim');
    expect(idDoErroDaLinha('funcionamento', 3, 0)).toBe('funcionamento-3-0-erro');
    expect(idDoErroDoDia('jornada', 0)).toBe('jornada-0-erro');
  });
});

describe('valores e leitura', () => {
  it('valoresDaSemana: HH:MM e 6 linhas por dia', () => {
    const v = valoresDaSemana(SEMANA);
    expect(v[1].slice(0, 3)).toEqual([
      { inicio: '09:00', fim: '12:00' },
      { inicio: '13:00', fim: '18:00' },
      { inicio: '', fim: '' },
    ]);
    expect(v[5][0]).toEqual({ inicio: '22:00', fim: '24:00' });
    expect(Object.values(v).every((l) => l.length === 6)).toBe(true);
  });

  it('lerSemanaDoFormulario: só os nomes conhecidos; eco cortado; arquivos viram ""', () => {
    const fd = new FormData();
    fd.set('inicio-2-0', '09:00');
    fd.set('fim-2-0', '12:00');
    fd.set('inicio-3-5', 'x'.repeat(50));
    fd.set('fim-3-0', new Blob(['a']));
    fd.set('inicio-2-6', '10:00');
    fd.set('salaoId', 'forjado');
    const { dias, valores } = lerSemanaDoFormulario(fd);
    expect(dias.map((d) => d.diaSemana)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(dias[2].intervalos[0]).toEqual({ inicio: '09:00', fim: '12:00' });
    expect(dias[2].intervalos).toHaveLength(6);
    expect(dias[3].intervalos[5].inicio).toHaveLength(50);
    expect(valores[3][5].inicio).toHaveLength(10);
    expect(dias[3].intervalos[0].fim).toBe('');
  });
});

describe('textos', () => {
  it('intervalos, pausas e resumo com o texto do dia vazio', () => {
    expect(textoDosIntervalos(SEMANA[0], 'Fechado')).toBe('Fechado');
    expect(textoDosIntervalos(SEMANA[1], 'Fechado')).toBe('09:00–12:00, 13:00–18:00');
    expect(textoDasPausas(SEMANA[1])).toBe('Pausa 12:00–13:00');
    expect(textoDasPausas(SEMANA[0])).toBeNull();
    expect(resumoDoDia(SEMANA[1], 'Folga')).toBe('09:00–12:00, 13:00–18:00 · Pausa 12:00–13:00');
    expect(resumoDoDia(SEMANA[5], 'Fechado')).toBe('22:00–24:00');
    const duas = montarSemana([
      { diaSemana: 2, inicioMin: 540, fimMin: 600 },
      { diaSemana: 2, inicioMin: 630, fimMin: 720 },
      { diaSemana: 2, inicioMin: 780, fimMin: 900 },
    ]);
    expect(textoDasPausas(duas[2])).toBe('Pausas 10:00–10:30, 12:00–13:00');
  });
});

describe('itensDoResumo', () => {
  it('segunda → domingo, link para o primeiro campo afetado, com prefixo', () => {
    expect(
      itensDoResumo('funcionamento', {
        dias: {
          0: { intervalos: { 1: { fim: 'F' } } },
          1: { dia: 'L', intervalos: { 2: { intervalo: 'S' }, 0: { inicio: 'I', fim: 'F2' } } },
        },
      }),
    ).toEqual([
      { href: '#funcionamento-1-0-inicio', texto: 'Segunda-feira: L' },
      { href: '#funcionamento-1-0-inicio', texto: 'Segunda-feira, intervalo 1: I' },
      { href: '#funcionamento-1-2-inicio', texto: 'Segunda-feira, intervalo 3: S' },
      { href: '#funcionamento-0-1-fim', texto: 'Domingo, intervalo 2: F' },
    ]);
    expect(itensDoResumo('x', {})).toEqual([]);
    expect(itensDoResumo('x', { formulario: 'f' })).toEqual([]);
  });
});
