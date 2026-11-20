import type pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { salvarJornada } from '@/server/jornadas/jornadas.acao';
import { desativarProfissional, reativarProfissional } from '@/server/profissionais/profissionais.acao';
import type { Credencial } from '@/server/tenant/sessao';

import { credencialDoGestor } from '../../support/auth';
import { criarDoisSaloes } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { conectar } from '../../support/sql';

import { faixasJornada, jornadaDoSalao, linhasJornada, semana } from './apoio';
import type { SemanaTexto } from './apoio';

// D-015 T-9 (tester): regressão independente da validação e da atomicidade pela AÇÃO real, contra
// PostgreSQL real. Cada caso confere o banco antes e depois.

let c: pg.Client;
let a: SalaoCompleto;
let b: SalaoCompleto;
let g: Credencial;

beforeAll(async () => {
  c = await conectar();
  ({ a, b } = await criarDoisSaloes());
  g = await credencialDoGestor(a);
});
afterAll(async () => {
  await c.end();
});
beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

async function novoProfissional(): Promise<string> {
  const { rows } = await c.query<{ id: string }>(
    "INSERT INTO profissional (salao_id, nome) VALUES ($1, 'Regressao') RETURNING id::text AS id",
    [a.salaoId],
  );
  return rows[0].id;
}

const salvar = (id: string, dias: SemanaTexto) => salvarJornada.executar(g, semana(id, dias));

describe('tester: horários recusados não gravam nada (atomicidade)', () => {
  it.each([
    ['início 24:00', ['24:00', '24:00']],
    ['fim 24:05', ['22:00', '24:05']],
    ['fim 25:00', ['22:00', '25:00']],
    ['12:60', ['12:00', '12:60']],
    ['9h', ['9h', '12:00']],
    ['segundos', ['09:00:00', '12:00']],
    ['negativo', ['-1:00', '12:00']],
    ['sem dois pontos', ['0900', '1200']],
    ['minuto com 1 dígito', ['9:0', '12:00']],
    ['três dígitos na hora', ['009:00', '12:00']],
    ['dígitos não ASCII', ['٠٩:٠٠', '12:00']],
    ['granularidade no fim', ['09:00', '12:03']],
    ['só início', ['09:00', '']],
    ['só fim', ['', '12:00']],
    ['texto', ['abc', 'def']],
    ['00:00 como fim', ['09:00', '00:00']],
  ] as [string, [string, string]][])('%s num domingo, com os outros dias válidos → invalido e jornada intacta', async (_n, faixa) => {
    const id = await novoProfissional();
    expect((await salvar(id, { 2: [['08:00', '17:00']] })).ok).toBe(true);
    const antes = await linhasJornada(c, id);
    const r = await salvar(id, { 1: [['09:00', '18:00']], 3: [['10:00', '11:00']], 0: [faixa] });
    expect(r).toMatchObject({ ok: true, dados: { resultado: 'invalido', erros: { dias: { 0: expect.any(Object) } } } });
    expect(await linhasJornada(c, id)).toEqual(antes);
  });

  it('sobreposições (aninhada, idêntica, não vizinha) → recusadas, nada gravado', async () => {
    const id = await novoProfissional();
    for (const dias of [
      { 4: [['08:00', '18:00'], ['09:00', '10:00']] },
      { 4: [['09:00', '12:00'], ['09:00', '12:00']] },
      { 4: [['08:00', '18:00'], ['09:00', '10:00'], ['12:00', '13:00']] },
      { 4: [['13:00', '14:00'], ['09:00', '12:00'], ['11:55', '12:05']] },
    ] as SemanaTexto[]) {
      expect(await salvar(id, dias)).toMatchObject({ ok: true, dados: { resultado: 'invalido' } });
    }
    expect(await faixasJornada(c, id)).toEqual([]);
  });
});

describe('tester: aceitos e forma canônica', () => {
  it('00:00–24:00, " 9:00 ", contíguos em cadeia fora de ordem e 6 intervalos com linhas vazias', async () => {
    const id = await novoProfissional();
    const r = await salvar(id, {
      0: [['00:00', '24:00']],
      1: [[' 9:00 ', '10:00']],
      2: [['13:00', '14:00'], ['09:00', '12:00'], ['', ''], ['12:00', '13:00']],
      6: [['08:00', '08:05'], ['09:00', '09:05'], ['10:00', '10:05'], ['', ''], ['11:00', '11:05'], ['12:00', '12:05'], ['13:00', '13:05']],
    });
    expect(r).toMatchObject({ ok: true, dados: { resultado: 'salvo' } });
    expect(await faixasJornada(c, id)).toEqual([
      [0, 0, 1440],
      [1, 540, 600],
      [2, 540, 840],
      [6, 480, 485],
      [6, 540, 545],
      [6, 600, 605],
      [6, 660, 665],
      [6, 720, 725],
      [6, 780, 785],
    ]);
  });

  it('7 intervalos não vazios no mesmo dia → recusado (limite antes da união de contíguos)', async () => {
    const id = await novoProfissional();
    const sete = Array.from({ length: 7 }, (_, i) => [`${String(8 + i).padStart(2, '0')}:00`, `${String(9 + i).padStart(2, '0')}:00`]);
    expect(await salvar(id, { 3: sete as [string, string][] })).toMatchObject({
      ok: true,
      dados: { resultado: 'invalido', erros: { dias: { 3: { dia: expect.any(String) } } } },
    });
    expect(await faixasJornada(c, id)).toEqual([]);
  });

  it('salvar de novo a mesma semana preserva ids; desativar/reativar não mexe na jornada', async () => {
    const id = await novoProfissional();
    expect((await salvar(id, { 1: [['09:00', '12:00'], ['13:00', '18:00']] })).ok).toBe(true);
    const antes = await linhasJornada(c, id);
    expect(await salvar(id, { 1: [['13:00', '18:00'], ['09:00', '12:00']] })).toMatchObject({
      ok: true,
      dados: { resultado: 'salvo', inseridos: 0, removidos: 0 },
    });
    expect(await linhasJornada(c, id)).toEqual(antes);
    expect((await desativarProfissional.executar(g, { id })).ok).toBe(true);
    expect(await linhasJornada(c, id)).toEqual(antes);
    expect((await reativarProfissional.executar(g, { id })).ok).toBe(true);
    expect(await linhasJornada(c, id)).toEqual(antes);
  });
});

describe('tester: isolamento', () => {
  it('gestor de A com ids de B (válida) → 404; B idêntico; A idêntico', async () => {
    const antesA = await jornadaDoSalao(c, a.salaoId);
    const antesB = await jornadaDoSalao(c, b.salaoId);
    for (const id of [b.profissional.profissionalId, b.profissionalInativoId]) {
      expect(await salvar(id, {})).toEqual({ ok: false, erro: 'nao_encontrado', status: 404 });
    }
    expect(await jornadaDoSalao(c, b.salaoId)).toEqual(antesB);
    expect(await jornadaDoSalao(c, a.salaoId)).toEqual(antesA);
  });
});
