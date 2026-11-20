import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { repos } from '@/server/repos';
import { emTransacao } from '@/server/repos/transacao';
import { NaoEncontrado } from '@/server/tenant/erros';

import { criarDoisSaloes, criarSalaoCompleto } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { conectar, erroSql } from '../../support/sql';

import { UUID_INEXISTENTE, ctxDoGestor, faixasJornada, jornadaDoSalao, linhasJornada } from './apoio';

// D-015 T-2: repositório da jornada contra PostgreSQL real, com dois salões (G-4). CA-11 na camada de
// dados, a garantia final da exclusion (23P01) e o DELETE + INSERT na mesma transação (R-4).

let c: pg.Client;
let a: SalaoCompleto;
let b: SalaoCompleto;

beforeAll(async () => {
  c = await conectar();
  ({ a, b } = await criarDoisSaloes());
});
afterAll(async () => {
  await c.end();
});

const PADRAO: [number, number, number][] = [1, 2, 3, 4, 5, 6].flatMap((d) => [
  [d, 540, 720] as [number, number, number],
  [d, 780, 1080] as [number, number, number],
]);

describe('listarDoProfissional', () => {
  it('lista ordenada por dia e início, só do salão do contexto (CA-11)', async () => {
    const id = a.profissional.profissionalId;
    const linhas = await repos().jornadas.listarDoProfissional(ctxDoGestor(a), id);
    expect(linhas.map((l) => [l.diaSemana, l.inicioMin, l.fimMin])).toEqual(PADRAO);
    expect(linhas.map((l) => l.id).sort()).toEqual((await linhasJornada(c, id)).map((l) => l.id).sort());
    // Profissional de B com o contexto de A → nenhuma linha (filtro por salao_id).
    expect(await repos().jornadas.listarDoProfissional(ctxDoGestor(a), b.profissional.profissionalId)).toEqual([]);
  });
});

describe('buscarProfissional e travarProfissional', () => {
  it('devolvem id, nome e ativo do profissional do salão', async () => {
    const id = a.profissional.profissionalId;
    const esperado = { id, nome: a.profissional.nome, ativo: true };
    expect(await repos().jornadas.buscarProfissional(ctxDoGestor(a), id)).toEqual(esperado);
    expect(await emTransacao((t) => t.jornadas.travarProfissional(ctxDoGestor(a), id))).toEqual(esperado);
  });

  it('não filtram inativo (RN-13)', async () => {
    const id = a.profissionalInativoId;
    expect(await repos().jornadas.buscarProfissional(ctxDoGestor(a), id)).toMatchObject({ id, ativo: false });
    expect(await emTransacao((t) => t.jornadas.travarProfissional(ctxDoGestor(a), id))).toMatchObject({ id, ativo: false });
  });

  it('profissional de B, inexistente ou malformado → NaoEncontrado (CA-11)', async () => {
    for (const id of [b.profissional.profissionalId, UUID_INEXISTENTE, 'abc']) {
      await expect(repos().jornadas.buscarProfissional(ctxDoGestor(a), id)).rejects.toBeInstanceOf(NaoEncontrado);
      await expect(emTransacao((t) => t.jornadas.travarProfissional(ctxDoGestor(a), id))).rejects.toBeInstanceOf(NaoEncontrado);
    }
  });
});

describe('aplicarDiferenca', () => {
  it('remove e insere no salão do contexto; listas vazias não gravam nada', async () => {
    const s = await criarSalaoCompleto();
    const id = s.profissional.profissionalId;
    const ctx = ctxDoGestor(s);
    const antes = await linhasJornada(c, id);
    expect(await emTransacao((t) => t.jornadas.aplicarDiferenca(ctx, id, { remover: [], inserir: [] }))).toEqual({
      removidos: 0,
      inseridos: 0,
    });
    expect(await linhasJornada(c, id)).toEqual(antes);

    const segunda = antes.filter((l) => l.dia_semana === 1).map((l) => l.id);
    const r = await emTransacao((t) =>
      t.jornadas.aplicarDiferenca(ctx, id, { remover: segunda, inserir: [{ diaSemana: 0, inicioMin: 600, fimMin: 660 }] }),
    );
    expect(r).toEqual({ removidos: 2, inseridos: 1 });
    const depois = await faixasJornada(c, id);
    expect(depois[0]).toEqual([0, 600, 660]);
    expect(depois.filter(([d]) => d === 1)).toEqual([]);
    const { rows } = await c.query('SELECT salao_id::text AS s FROM jornada WHERE profissional_id = $1 AND dia_semana = 0', [id]);
    expect(rows).toEqual([{ s: s.salaoId }]);
  });

  it('R-4: DELETE de (1, 540, 720) + INSERT de (1, 600, 780) na mesma transação não viola a exclusion', async () => {
    const s = await criarSalaoCompleto();
    const id = s.profissional.profissionalId;
    const alvo = (await linhasJornada(c, id)).find((l) => l.dia_semana === 1 && l.inicio_min === 540)!;
    // (600, 780) sobrepõe a linha apagada (540, 720) e encosta em (780, 1080) sem sobrepor.
    const r = await emTransacao((t) =>
      t.jornadas.aplicarDiferenca(ctxDoGestor(s), id, { remover: [alvo.id], inserir: [{ diaSemana: 1, inicioMin: 600, fimMin: 780 }] }),
    );
    expect(r).toEqual({ removidos: 1, inseridos: 1 });
    expect((await faixasJornada(c, id)).filter(([d]) => d === 1)).toEqual([
      [1, 600, 780],
      [1, 780, 1080],
    ]);
  });

  it('ids de outro profissional ou de B no remover não são tocados (CA-11)', async () => {
    const fotoB = await jornadaDoSalao(c, b.salaoId);
    const idsB = (await linhasJornada(c, b.profissional.profissionalId)).map((l) => l.id);
    const idsOutro = (await linhasJornada(c, a.gestor.profissionalId!)).map((l) => l.id);
    const antesOutro = await linhasJornada(c, a.gestor.profissionalId!);
    const r = await emTransacao((t) =>
      t.jornadas.aplicarDiferenca(ctxDoGestor(a), a.profissional.profissionalId, { remover: [...idsB, ...idsOutro, 'abc'], inserir: [] }),
    );
    expect(r).toEqual({ removidos: 0, inseridos: 0 });
    expect(await jornadaDoSalao(c, b.salaoId)).toEqual(fotoB);
    expect(await linhasJornada(c, a.gestor.profissionalId!)).toEqual(antesOutro);
  });

  it('profissional de B com o contexto de A: a FK composta recusa o INSERT (segunda barreira)', async () => {
    const fotoB = await jornadaDoSalao(c, b.salaoId);
    await expect(
      emTransacao((t) =>
        t.jornadas.aplicarDiferenca(ctxDoGestor(a), b.profissional.profissionalId, {
          remover: [],
          inserir: [{ diaSemana: 0, inicioMin: 0, fimMin: 60 }],
        }),
      ),
    ).rejects.toThrow();
    expect(await jornadaDoSalao(c, b.salaoId)).toEqual(fotoB);
  });
});

describe('garantia final no banco', () => {
  it('sobreposição inserida por SQL direto → 23P01 jornada_sem_sobreposicao', async () => {
    const id = a.profissional.profissionalId;
    expect(
      await erroSql(
        c.query('INSERT INTO jornada (salao_id, profissional_id, dia_semana, inicio_min, fim_min) VALUES ($1, $2, 1, 600, 660)', [
          a.salaoId,
          id,
        ]),
      ),
    ).toEqual({ code: '23P01', constraint: 'jornada_sem_sobreposicao' });
  });

  it('cruzar a meia-noite (fim ≤ início) → 23514 jornada_faixa_chk', async () => {
    expect(
      await erroSql(
        c.query('INSERT INTO jornada (salao_id, profissional_id, dia_semana, inicio_min, fim_min) VALUES ($1, $2, 0, 1320, 120)', [
          a.salaoId,
          a.profissional.profissionalId,
        ]),
      ),
    ).toEqual({ code: '23514', constraint: 'jornada_faixa_chk' });
  });
});
