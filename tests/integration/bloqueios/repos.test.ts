import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { repos } from '@/server/repos';
import { consultaReservasQueCruzam } from '@/server/repos/reserva';
import { emTransacao } from '@/server/repos/transacao';
import { contextoDeSistema } from '@/server/tenant/context';
import { NaoEncontrado } from '@/server/tenant/erros';

import { criarDoisSaloes, criarSalaoCompleto } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { conectar } from '../../support/sql';

import {
  MANAUS,
  UUID_INEXISTENTE,
  anonimizarCliente,
  apagarBloqueios,
  criarReservaEm,
  ctxDoGestor,
  inserirBloqueio,
  linhaBloqueio,
  linhasBloqueio,
} from './apoio';

// D-016 T-3: repositórios de bloqueio e de reservas cobertas contra PostgreSQL real, com dois salões
// (G-4). CRUD com escopo, listas, intersecção semiaberta (R-4), telefone nunca lido (R-5) e o plano da
// consulta de reservas cobertas pelo índice parcial da exclusion (R-3).

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

const d = (iso: string) => new Date(iso);

describe('fuso, profissionais e alvo', () => {
  it('fusoDoSalao lê salao.fuso do salão do contexto', async () => {
    const s = await criarSalaoCompleto({ salao: { fuso: MANAUS } });
    expect(await repos().bloqueios.fusoDoSalao(ctxDoGestor(s))).toBe(MANAUS);
    expect(await repos().bloqueios.fusoDoSalao(contextoDeSistema(a.salaoId, 'teste'))).toBe('America/Sao_Paulo');
  });

  it('fusoDoSalao com salão inexistente → NaoEncontrado', async () => {
    await expect(repos().bloqueios.fusoDoSalao(contextoDeSistema(UUID_INEXISTENTE, 'teste'))).rejects.toBeInstanceOf(NaoEncontrado);
  });

  it('buscarProfissional: ativo e inativo do salão; B, inexistente ou malformado → NaoEncontrado', async () => {
    const ctx = ctxDoGestor(a);
    expect(await repos().bloqueios.buscarProfissional(ctx, a.profissional.profissionalId)).toEqual({
      id: a.profissional.profissionalId,
      nome: a.profissional.nome,
      ativo: true,
    });
    expect(await repos().bloqueios.buscarProfissional(ctx, a.profissionalInativoId)).toMatchObject({ ativo: false });
    for (const id of [b.profissional.profissionalId, UUID_INEXISTENTE, 'abc']) {
      await expect(repos().bloqueios.buscarProfissional(ctx, id)).rejects.toBeInstanceOf(NaoEncontrado);
    }
  });

  it('listarProfissionais: só do salão, ativos primeiro e por nome', async () => {
    const lista = await repos().bloqueios.listarProfissionais(ctxDoGestor(a));
    expect(lista.map((p) => p.id).sort()).toEqual(
      [a.gestor.profissionalId!, a.profissional.profissionalId, a.profissionalInativoId].sort(),
    );
    expect(lista.at(-1)).toMatchObject({ id: a.profissionalInativoId, ativo: false });
    const ativos = lista.filter((p) => p.ativo).map((p) => p.nome);
    expect(ativos).toEqual([...ativos].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0)));
  });
});

describe('criar, buscar, travar, atualizar e remover', () => {
  it('ciclo completo com escopo; B intacto (CA-11, CA-13)', async () => {
    const ctx = ctxDoGestor(a);
    const antesB = await linhasBloqueio(c, b.salaoId);
    const criado = await repos().bloqueios.criar(ctx, {
      profissionalId: a.profissional.profissionalId,
      inicio: d('2026-12-10T17:00:00Z'),
      fim: d('2026-12-10T19:00:00Z'),
      motivo: 'Dentista',
    });
    expect(criado).toEqual({
      id: expect.any(String),
      profissionalId: a.profissional.profissionalId,
      inicio: d('2026-12-10T17:00:00Z'),
      fim: d('2026-12-10T19:00:00Z'),
      motivo: 'Dentista',
      profissional: { id: a.profissional.profissionalId, nome: a.profissional.nome, ativo: true },
    });
    expect(await repos().bloqueios.buscar(ctx, criado.id)).toEqual(criado);
    expect(await emTransacao((t) => t.bloqueios.travar(ctx, criado.id))).toEqual(criado);

    const editado = await emTransacao((t) =>
      t.bloqueios.atualizarPeriodo(ctx, criado.id, { inicio: d('2026-12-11T17:00:00Z'), fim: d('2026-12-11T18:00:00Z'), motivo: null }),
    );
    expect(editado).toEqual({ ...criado, inicio: d('2026-12-11T17:00:00Z'), fim: d('2026-12-11T18:00:00Z'), motivo: null });
    expect(await linhaBloqueio(c, criado.id)).toEqual({
      id: criado.id,
      profissional_id: a.profissional.profissionalId,
      inicio: '2026-12-11T17:00:00Z',
      fim: '2026-12-11T18:00:00Z',
      motivo: null,
    });

    await repos().bloqueios.remover(ctx, criado.id);
    expect(await linhaBloqueio(c, criado.id)).toBeUndefined();
    await expect(repos().bloqueios.remover(ctx, criado.id)).rejects.toBeInstanceOf(NaoEncontrado);
    expect(await linhasBloqueio(c, b.salaoId)).toEqual(antesB);
  });

  it('bloqueio do salão inteiro: profissional null', async () => {
    const ctx = ctxDoGestor(a);
    const criado = await repos().bloqueios.criar(ctx, {
      profissionalId: null,
      inicio: d('2026-12-25T03:00:00Z'),
      fim: d('2026-12-26T03:00:00Z'),
      motivo: null,
    });
    expect(criado).toMatchObject({ profissionalId: null, profissional: null });
    expect(await emTransacao((t) => t.bloqueios.travar(ctx, criado.id))).toEqual(criado);
    await repos().bloqueios.remover(ctx, criado.id);
  });

  it('bloqueio de B com o contexto de A → NaoEncontrado em buscar/travar/atualizar/remover; linha de B intacta', async () => {
    const ctx = ctxDoGestor(a);
    const antes = await linhaBloqueio(c, b.bloqueioId);
    for (const id of [b.bloqueioId, UUID_INEXISTENTE]) {
      await expect(repos().bloqueios.buscar(ctx, id)).rejects.toBeInstanceOf(NaoEncontrado);
      await expect(emTransacao((t) => t.bloqueios.travar(ctx, id))).rejects.toBeInstanceOf(NaoEncontrado);
      await expect(
        repos().bloqueios.atualizarPeriodo(ctx, id, { inicio: d('2026-12-11T17:00:00Z'), fim: d('2026-12-11T18:00:00Z'), motivo: 'x' }),
      ).rejects.toBeInstanceOf(NaoEncontrado);
      await expect(repos().bloqueios.remover(ctx, id)).rejects.toBeInstanceOf(NaoEncontrado);
    }
    expect(await linhaBloqueio(c, b.bloqueioId)).toEqual(antes);
  });

  it('criar com profissional de B: a FK composta recusa (segunda barreira, nada gravado em B)', async () => {
    const antesB = await linhasBloqueio(c, b.salaoId);
    await expect(
      repos().bloqueios.criar(ctxDoGestor(a), {
        profissionalId: b.profissional.profissionalId,
        inicio: d('2026-12-10T17:00:00Z'),
        fim: d('2026-12-10T19:00:00Z'),
        motivo: null,
      }),
    ).rejects.toThrow();
    expect(await linhasBloqueio(c, b.salaoId)).toEqual(antesB);
  });

  it('criar com profissional malformado → NaoEncontrado sem consultar', async () => {
    await expect(
      repos().bloqueios.criar(ctxDoGestor(a), { profissionalId: 'abc', inicio: d('2026-12-10T17:00:00Z'), fim: d('2026-12-10T19:00:00Z'), motivo: null }),
    ).rejects.toBeInstanceOf(NaoEncontrado);
  });
});

describe('listarVigentes (RN-18) e listarNoPeriodo', () => {
  let s: SalaoCompleto;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    s = await criarSalaoCompleto();
    await apagarBloqueios(c, s.salaoId);
    const p = s.profissional.profissionalId;
    const g = s.gestor.profissionalId!;
    ids.encerrado = await inserirBloqueio(c, { salaoId: s.salaoId, profissionalId: p, inicio: '2026-11-01T10:00Z', fim: '2026-11-01T12:00Z' });
    ids.emAndamento = await inserirBloqueio(c, { salaoId: s.salaoId, profissionalId: null, inicio: '2026-11-30T03:00Z', fim: '2026-12-02T03:00Z' });
    ids.futuroP = await inserirBloqueio(c, { salaoId: s.salaoId, profissionalId: p, inicio: '2026-12-10T17:00Z', fim: '2026-12-10T19:00Z' });
    ids.futuroG = await inserirBloqueio(c, { salaoId: s.salaoId, profissionalId: g, inicio: '2026-12-05T17:00Z', fim: '2026-12-05T19:00Z' });
    ids.futuroInativo = await inserirBloqueio(c, {
      salaoId: s.salaoId,
      profissionalId: s.profissionalInativoId,
      inicio: '2026-12-20T17:00Z',
      fim: '2026-12-20T19:00Z',
    });
    // Termina exatamente em AGORA: não é vigente (fim > agora).
    ids.terminaAgora = await inserirBloqueio(c, { salaoId: s.salaoId, profissionalId: p, inicio: '2026-12-01T10:00Z', fim: '2026-12-01T12:00Z' });
  });

  const AGORA = d('2026-12-01T12:00:00Z');

  it('todos: só fim > agora, por início; marca inativo; nada de B (CA-18, CA-13)', async () => {
    const lista = await repos().bloqueios.listarVigentes(ctxDoGestor(s), AGORA, { todos: true });
    expect(lista.map((x) => x.id)).toEqual([ids.emAndamento, ids.futuroG, ids.futuroP, ids.futuroInativo]);
    expect(lista[3].profissional).toMatchObject({ ativo: false });
    expect(lista[0].profissional).toBeNull();
  });

  it('do profissional: os dele + os do salão inteiro, nunca os de colegas', async () => {
    const lista = await repos().bloqueios.listarVigentes(ctxDoGestor(s), AGORA, { profissionalId: s.profissional.profissionalId });
    expect(lista.map((x) => x.id)).toEqual([ids.emAndamento, ids.futuroP]);
  });

  it('listarNoPeriodo: intersecção semiaberta, com e sem profissional', async () => {
    const r = repos().bloqueios;
    const ctx = ctxDoGestor(s);
    // [12-10 19:00, 12-20 17:00): encosta nos dois extremos → nenhum.
    expect(await r.listarNoPeriodo(ctx, { de: d('2026-12-10T19:00Z'), ate: d('2026-12-20T17:00Z') })).toEqual([]);
    // [12-10 18:59, 12-20 17:01) → futuroP e futuroInativo.
    const todos = await r.listarNoPeriodo(ctx, { de: d('2026-12-10T18:59Z'), ate: d('2026-12-20T17:01Z') });
    expect(todos.map((x) => x.id)).toEqual([ids.futuroP, ids.futuroInativo]);
    // Dezembro inteiro do profissional: os dele + o do salão.
    const doP = await r.listarNoPeriodo(ctx, { de: d('2026-12-01T00:00Z'), ate: d('2027-01-01T00:00Z') }, { profissionalId: s.profissional.profissionalId });
    expect(doP.map((x) => x.id)).toEqual([ids.emAndamento, ids.terminaAgora, ids.futuroP]);
    expect(doP[2]).toMatchObject({ profissional: { id: s.profissional.profissionalId, nome: s.profissional.nome, ativo: true } });
    // Contexto de A não enxerga os de s.
    expect(await r.listarNoPeriodo(ctxDoGestor(a), { de: d('2026-11-01T00:00Z'), ate: d('2026-11-01T12:00Z') })).toEqual([]);
  });
});

describe('listarConfirmadasQueCruzam (RN-8, R-4, R-5)', () => {
  let s: SalaoCompleto;
  let outroSalao: SalaoCompleto;
  const r: Record<string, string> = {};

  beforeAll(async () => {
    s = await criarSalaoCompleto();
    outroSalao = await criarSalaoCompleto();
    const base = { salaoId: s.salaoId, clienteId: s.clientes.ativaId };
    const p = s.profissional.profissionalId;
    const g = s.gestor.profissionalId!;
    // Bloqueio de referência: [2026-12-15 18:00Z, 2026-12-15 22:00Z).
    r.dentro = await criarReservaEm(c, { ...base, profissionalId: p, inicio: '2026-12-15T19:00Z', fim: '2026-12-15T20:00Z' });
    r.cruzaInicio = await criarReservaEm(c, { ...base, profissionalId: p, inicio: '2026-12-15T17:30Z', fim: '2026-12-15T18:30Z' });
    r.encostaAntes = await criarReservaEm(c, { ...base, profissionalId: g, inicio: '2026-12-15T17:00Z', fim: '2026-12-15T18:00Z', ocupadoAte: '2026-12-15T18:00Z' });
    r.encostaDepois = await criarReservaEm(c, { ...base, profissionalId: p, inicio: '2026-12-15T22:00Z', fim: '2026-12-15T23:00Z' });
    // ocupado_ate dentro do bloqueio, mas fim antes: não entra (sem ocupado_ate, D-7).
    r.soOcupado = await criarReservaEm(c, { ...base, profissionalId: s.profissionalInativoId, inicio: '2026-12-15T17:00Z', fim: '2026-12-15T18:00Z', ocupadoAte: '2026-12-15T18:30Z' });
    r.cancelada = await criarReservaEm(c, { ...base, profissionalId: p, inicio: '2026-12-15T20:00Z', fim: '2026-12-15T21:00Z', status: 'cancelado' });
    r.concluida = await criarReservaEm(c, { ...base, profissionalId: p, inicio: '2026-12-15T21:00Z', fim: '2026-12-15T21:30Z', status: 'concluido' });
    r.faltou = await criarReservaEm(c, { ...base, profissionalId: p, inicio: '2026-12-15T21:30Z', fim: '2026-12-15T22:00Z', status: 'nao_compareceu' });
    r.doGestor = await criarReservaEm(c, {
      salaoId: s.salaoId,
      clienteId: s.clientes.anonimizadaId,
      profissionalId: g,
      inicio: '2026-12-15T20:00Z',
      fim: '2026-12-15T21:00Z',
    });
    // Mesmo horário em outro salão: nunca aparece.
    r.outroSalao = await criarReservaEm(c, {
      salaoId: outroSalao.salaoId,
      clienteId: outroSalao.clientes.ativaId,
      profissionalId: outroSalao.profissional.profissionalId,
      inicio: '2026-12-15T19:00Z',
      fim: '2026-12-15T20:00Z',
    });
  });

  const BLOQUEIO = { de: d('2026-12-15T18:00Z'), ate: d('2026-12-15T22:00Z') };

  it('do profissional: confirmadas que intersectam, por início; encostar, cancelada, concluída, faltou e colega ficam de fora', async () => {
    const x = await repos().reservas.listarConfirmadasQueCruzam(ctxDoGestor(s), BLOQUEIO, s.profissional.profissionalId, 100);
    expect(x.total).toBe(2);
    expect(x.reservas).toEqual([
      {
        id: r.cruzaInicio,
        profissionalId: s.profissional.profissionalId,
        profissionalNome: s.profissional.nome,
        inicio: d('2026-12-15T17:30Z'),
        fim: d('2026-12-15T18:30Z'),
        clienteNome: s.clientes.nomeAtiva,
      },
      expect.objectContaining({ id: r.dentro }),
    ]);
    // R-5: chaves exatas, sem telefone.
    expect(Object.keys(x.reservas[0]).sort()).toEqual(['clienteNome', 'fim', 'id', 'inicio', 'profissionalId', 'profissionalNome']);
  });

  it('do salão (null): todos os profissionais do salão, cliente anonimizada com nome null; nada de outro salão', async () => {
    const x = await repos().reservas.listarConfirmadasQueCruzam(ctxDoGestor(s), BLOQUEIO, null, 100);
    expect(x.reservas.map((y) => y.id)).toEqual([r.cruzaInicio, r.dentro, r.doGestor]);
    expect(x.reservas[2]).toMatchObject({ profissionalId: s.gestor.profissionalId, clienteNome: null });
    expect(x.total).toBe(3);
  });

  it('cliente anonimizada depois de reservar → nome null', async () => {
    const t = await criarSalaoCompleto();
    const id = await criarReservaEm(c, {
      salaoId: t.salaoId,
      clienteId: t.clientes.ativaId,
      profissionalId: t.profissional.profissionalId,
      inicio: '2026-12-15T19:00Z',
      fim: '2026-12-15T20:00Z',
    });
    await anonimizarCliente(c, t.clientes.ativaId);
    const x = await repos().reservas.listarConfirmadasQueCruzam(ctxDoGestor(t), BLOQUEIO, null, 100);
    expect(x.reservas).toEqual([expect.objectContaining({ id, clienteNome: null })]);
  });

  it('limite: lista no máximo `limite`, total completo; sem resultado → total 0', async () => {
    const x = await repos().reservas.listarConfirmadasQueCruzam(ctxDoGestor(s), BLOQUEIO, null, 2);
    expect(x.reservas.map((y) => y.id)).toEqual([r.cruzaInicio, r.dentro]);
    expect(x.total).toBe(3);
    expect(
      await repos().reservas.listarConfirmadasQueCruzam(ctxDoGestor(s), { de: d('2030-01-01T00:00Z'), ate: d('2030-01-02T00:00Z') }, null, 10),
    ).toEqual({ reservas: [], total: 0 });
  });

  it('profissional de outro salão com o contexto de s → nenhuma reserva (filtro por salão)', async () => {
    const x = await repos().reservas.listarConfirmadasQueCruzam(ctxDoGestor(s), BLOQUEIO, outroSalao.profissional.profissionalId, 100);
    expect(x).toEqual({ reservas: [], total: 0 });
  });

  it('R-5: o texto da consulta não lê telefone', () => {
    const sql = consultaReservasQueCruzam(s.salaoId, BLOQUEIO, null, 10);
    expect(sql.text).not.toMatch(/telefone/i);
    expect(sql.text).toContain("r.status = 'confirmado'");
  });

  /**
   * Plano genérico (parâmetros $n desconhecidos, como o Prisma reaproveita) de `texto`, numa transação
   * desfeita no fim. Os índices btree de reserva por (salao_id, …, inicio) saem DENTRO da transação:
   * com tabelas minúsculas o custo os favorece, e o que a R-3 protege é a APLICABILIDADE do índice
   * parcial (a implicação status = 'confirmado' ⇒ predicado do índice). Com volume real (58 mil
   * reservas e ANALYZE) o planejador escolhe reserva_sem_sobreposicao sem isso (dev.md §4).
   */
  async function planoGenerico(texto: string, valores: unknown[]): Promise<string> {
    await c.query('BEGIN');
    try {
      for (const indice of [
        'reserva_salao_id_inicio_idx',
        'reserva_salao_id_profissional_id_inicio_idx',
        'reserva_salao_id_cliente_id_inicio_idx',
      ]) {
        await c.query(`DROP INDEX ${indice}`);
      }
      await c.query('SET LOCAL enable_seqscan = off');
      await c.query('SET LOCAL plan_cache_mode = force_generic_plan');
      // Os tipos dos parâmetros vêm dos casts do próprio texto.
      await c.query(`PREPARE plano_cobertas AS ${texto}`);
      const args = valores.map((v) => c.escapeLiteral(v instanceof Date ? v.toISOString() : String(v))).join(', ');
      const { rows } = await c.query<{ 'QUERY PLAN': string }>(`EXPLAIN EXECUTE plano_cobertas(${args})`);
      return rows.map((l) => l['QUERY PLAN']).join('\n');
    } finally {
      await c.query('ROLLBACK');
      await c.query('DEALLOCATE ALL');
    }
  }

  it.each([
    ['do profissional', true],
    ['do salão', false],
  ])('R-3: plano genérico (%s) usa o índice parcial reserva_sem_sobreposicao', async (_nome, comProfissional) => {
    const sql = consultaReservasQueCruzam(s.salaoId, BLOQUEIO, comProfissional ? s.profissional.profissionalId : null, 100);
    const plano = await planoGenerico(sql.text, sql.values);
    expect(plano).toContain('$1');
    expect(plano).toMatch(/Index Scan (using|on) reserva_sem_sobreposicao/);
    // Os índices voltaram (ROLLBACK).
    const { rows } = await c.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM pg_indexes WHERE tablename = 'reserva' AND indexname = 'reserva_salao_id_inicio_idx'",
    );
    expect(rows[0].n).toBe(1);
  });

  it('R-3 (controle): com o status como parâmetro, o índice parcial deixa de ser aplicável', async () => {
    const sql = consultaReservasQueCruzam(s.salaoId, BLOQUEIO, s.profissional.profissionalId, 100);
    const comParametro = sql.text.replace("r.status = 'confirmado'", `r.status = $${sql.values.length + 1}::status_reserva`);
    expect(comParametro).not.toBe(sql.text);
    const plano = await planoGenerico(comParametro, [...sql.values, 'confirmado']);
    expect(plano).not.toContain('reserva_sem_sobreposicao');
  });
});
