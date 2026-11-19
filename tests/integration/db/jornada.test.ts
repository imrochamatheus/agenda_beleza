import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { conectar, criarProfissional, criarSalao, erroSql } from '../../support/sql';

// CA-13 e CA-19 (RN-1): jornada em minutos locais, sem sobreposição por profissional e dia.
let c: pg.Client;

beforeAll(async () => {
  c = await conectar();
});

afterAll(async () => {
  await c.end();
});

async function profissionalNovo(): Promise<{ salaoId: string; profissionalId: string }> {
  const salaoId = await criarSalao(c);
  return { salaoId, profissionalId: await criarProfissional(c, salaoId) };
}

function inserirJornada(p: { salaoId: string; profissionalId: string }, dia: number, inicio: number, fim: number) {
  return c.query(
    'INSERT INTO jornada (salao_id, profissional_id, dia_semana, inicio_min, fim_min) VALUES ($1, $2, $3, $4, $5)',
    [p.salaoId, p.profissionalId, dia, inicio, fim],
  );
}

async function jornadas(profissionalId: string): Promise<number> {
  const r = await c.query<{ n: number }>('SELECT count(*)::int AS n FROM jornada WHERE profissional_id = $1', [
    profissionalId,
  ]);
  return r.rows[0].n;
}

const SEGUNDA = 1;
const TERCA = 2;

describe('jornada', () => {
  it('CA-13: intervalo sobreposto do mesmo profissional no mesmo dia é rejeitado (23P01)', async () => {
    const p = await profissionalNovo();
    await inserirJornada(p, SEGUNDA, 540, 720);
    const erro = await erroSql(inserirJornada(p, SEGUNDA, 600, 800));
    expect(erro).toEqual({ code: '23P01', constraint: 'jornada_sem_sobreposicao' });
    expect(await jornadas(p.profissionalId)).toBe(1);
  });

  it('CA-19: intervalo adjacente no mesmo dia e o mesmo intervalo em outro dia são aceitos', async () => {
    const p = await profissionalNovo();
    await inserirJornada(p, SEGUNDA, 540, 720);
    await inserirJornada(p, SEGUNDA, 720, 1080);
    await inserirJornada(p, TERCA, 540, 720);
    expect(await jornadas(p.profissionalId)).toBe(3);
  });

  it('CA-19: outro profissional pode ter o mesmo intervalo no mesmo dia', async () => {
    const p = await profissionalNovo();
    const outro = { salaoId: p.salaoId, profissionalId: await criarProfissional(c, p.salaoId) };
    await inserirJornada(p, SEGUNDA, 540, 720);
    await inserirJornada(outro, SEGUNDA, 540, 720);
    expect(await jornadas(outro.profissionalId)).toBe(1);
  });

  it('CA-19: o dia inteiro (0 a 1440) é aceito', async () => {
    const p = await profissionalNovo();
    await inserirJornada(p, 0, 0, 1440);
    await inserirJornada(p, 6, 0, 1440);
    expect(await jornadas(p.profissionalId)).toBe(2);
  });

  it.each([
    ['inicio_min = fim_min', SEGUNDA, 720, 720],
    ['inicio_min > fim_min', SEGUNDA, 800, 700],
    ['fim_min > 1440', SEGUNDA, 1000, 1441],
    ['inicio_min < 0', SEGUNDA, -1, 60],
  ])('CA-19: %s é rejeitado pelo CHECK de faixa (23514)', async (_caso, dia, inicio, fim) => {
    const p = await profissionalNovo();
    const erro = await erroSql(inserirJornada(p, dia, inicio, fim));
    expect(erro).toEqual({ code: '23514', constraint: 'jornada_faixa_chk' });
    expect(await jornadas(p.profissionalId)).toBe(0);
  });

  it.each([-1, 7])('CA-19: dia_semana %i é rejeitado pelo CHECK (23514)', async (dia) => {
    const p = await profissionalNovo();
    const erro = await erroSql(inserirJornada(p, dia, 540, 720));
    expect(erro).toEqual({ code: '23514', constraint: 'jornada_dia_semana_chk' });
  });
});
