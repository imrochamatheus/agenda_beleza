import { describe, expect, it } from 'vitest';

import { SEGMENTOS_RESERVADOS } from '@/config/navegacao';

import {
  chaveDeData,
  lerAviso,
  lerData,
  lerHorario,
  lerPasso,
  lerProfissional,
  lerServicoIds,
  montarHref,
  slugPlausivel,
} from './passos';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const HOJE = { ano: 2026, mes: 11, dia: 20 };
const CTX = { hoje: HOJE, janelaDias: 60 };

describe('slugPlausivel (CA-3, RN-2)', () => {
  it('aceita slugs válidos e recusa maiúsculas, caracteres especiais, longos e não texto', () => {
    expect(slugPlausivel('studio-bela')).toBe(true);
    expect(slugPlausivel('Studio')).toBe(false);
    expect(slugPlausivel('a_b')).toBe(false);
    expect(slugPlausivel('favicon.ico')).toBe(false);
    expect(slugPlausivel('a'.repeat(51))).toBe(false);
    expect(slugPlausivel('a'.repeat(50))).toBe(true);
    expect(slugPlausivel('-a')).toBe(false);
    expect(slugPlausivel('')).toBe(false);
    expect(slugPlausivel(undefined)).toBe(false);
  });

  it('nenhum segmento reservado é plausível (não consulta o banco)', () => {
    for (const reservado of SEGMENTOS_RESERVADOS) expect(slugPlausivel(reservado), reservado).toBe(false);
  });
});

describe('leitores de parâmetros', () => {
  it('lerServicoIds: 1 a 10, sem repetição, ordem e caixa', () => {
    expect(lerServicoIds([B, A.toUpperCase()])).toEqual([B, A]);
    expect(lerServicoIds(A)).toEqual([A]);
    expect(lerServicoIds(undefined)).toBeNull();
    expect(lerServicoIds([])).toBeNull();
    expect(lerServicoIds([A, A])).toBeNull();
    expect(lerServicoIds([A, 'x'])).toBeNull();
    const onze = Array.from({ length: 11 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    expect(lerServicoIds(onze)).toBeNull();
    expect(lerServicoIds(onze.slice(0, 10))).toHaveLength(10);
  });

  it('lerProfissional: qualquer ou UUID', () => {
    expect(lerProfissional('qualquer')).toBe('qualquer');
    expect(lerProfissional(A.toUpperCase())).toBe(A);
    expect(lerProfissional('x')).toBeNull();
    expect(lerProfissional(undefined)).toBeNull();
  });

  it('lerData: só datas reais', () => {
    expect(lerData('2026-12-01')).toEqual({ ano: 2026, mes: 12, dia: 1 });
    expect(lerData('2026-02-30')).toBeNull();
    expect(lerData('2026-1-1')).toBeNull();
    expect(lerData(undefined)).toBeNull();
    expect(chaveDeData({ ano: 2026, mes: 1, dia: 5 })).toBe('2026-01-05');
  });

  it('lerHorario: só ISO UTC canônico com segundos zero', () => {
    expect(lerHorario('2026-12-01T12:00:00.000Z')?.getTime()).toBe(Date.UTC(2026, 11, 1, 12));
    expect(lerHorario('2026-12-01T12:00:30.000Z')).toBeNull();
    expect(lerHorario('2026-12-01T12:00:00Z')).toBeNull();
    expect(lerHorario('2026-13-01T12:00:00.000Z')).toBeNull();
    expect(lerHorario('2026-12-01T09:00:00-03:00')).toBeNull();
    expect(lerHorario(undefined)).toBeNull();
  });

  it('lerAviso: só códigos fechados', () => {
    expect(lerAviso('horario_indisponivel')).toBe('horario_indisponivel');
    expect(lerAviso('<script>')).toBeNull();
    expect(lerAviso(undefined)).toBeNull();
  });
});

describe('lerPasso: parâmetro inválido volta ao passo anterior (nunca erro)', () => {
  const h = '2026-12-01T12:00:00.000Z';

  it('sem parâmetros ou serviços inválidos: servicos', () => {
    expect(lerPasso({}, CTX).passo).toBe('servicos');
    expect(lerPasso({ s: 'x', p: 'qualquer' }, CTX).passo).toBe('servicos');
  });

  it('serviços válidos, profissional ausente/inválido: profissional', () => {
    expect(lerPasso({ s: [A, B] }, CTX)).toEqual({ passo: 'profissional', s: [A, B], aviso: null });
    expect(lerPasso({ s: A, p: 'nao' }, CTX).passo).toBe('profissional');
  });

  it('data ausente, inválida ou fora da janela: data (com `de` ajustado)', () => {
    expect(lerPasso({ s: A, p: 'qualquer' }, CTX)).toMatchObject({ passo: 'data', de: HOJE });
    expect(lerPasso({ s: A, p: 'qualquer', data: '2026-02-30' }, CTX).passo).toBe('data');
    expect(lerPasso({ s: A, p: 'qualquer', data: '2026-11-19' }, CTX).passo).toBe('data');
    expect(lerPasso({ s: A, p: 'qualquer', data: '2027-01-20' }, CTX)).toMatchObject({ passo: 'data' });
    expect(lerPasso({ s: A, p: 'qualquer', data: '2027-01-21' }, CTX).passo).toBe('data');
    expect(lerPasso({ s: A, p: 'qualquer', de: '2026-01-01' }, CTX)).toMatchObject({ de: HOJE });
    expect(lerPasso({ s: A, p: 'qualquer', de: '2030-01-01' }, CTX)).toMatchObject({ de: { ano: 2027, mes: 1, dia: 19 } });
    expect(lerPasso({ s: A, p: 'qualquer', de: '2026-12-05' }, CTX)).toMatchObject({ de: { ano: 2026, mes: 12, dia: 5 } });
  });

  it('data válida: horario; com h válido: dados; h inválido: horario', () => {
    expect(lerPasso({ s: A, p: 'qualquer', data: '2026-12-01' }, CTX).passo).toBe('horario');
    expect(lerPasso({ s: A, p: 'qualquer', data: '2026-12-01', h: 'lixo' }, CTX).passo).toBe('horario');
    const dados = lerPasso({ s: A, p: A, data: '2026-12-01', h, aviso: 'sem_profissional' }, CTX);
    expect(dados).toMatchObject({ passo: 'dados', aviso: 'sem_profissional' });
  });
});

describe('montarHref', () => {
  it('repete s, codifica e omite o que não veio', () => {
    expect(montarHref('/x', {})).toBe('/x');
    expect(montarHref('/x', { s: [A, B], p: 'qualquer', data: '2026-12-01', h: '2026-12-01T12:00:00.000Z' })).toBe(
      `/x?s=${A}&s=${B}&p=qualquer&data=2026-12-01&h=2026-12-01T12%3A00%3A00.000Z`,
    );
    expect(montarHref('/x', { aviso: 'horario_indisponivel' })).toBe('/x?aviso=horario_indisponivel');
  });
});
