import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { repos } from '@/server/repos';
import { emTransacao } from '@/server/repos/transacao';
import { contextoDeSistema } from '@/server/tenant/context';
import { NaoEncontrado } from '@/server/tenant/erros';

import { criarDoisSaloes, criarSalaoCompleto } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { conectar } from '../../support/sql';

import { MANAUS, UUID_INEXISTENTE, atuaisDe, ctxDoGestor, inserirSlug, linhaSalao, slugsDe } from './apoio';

// D-017 T-3: RepoSalao contra PostgreSQL real, com dois salões (G-4). Escopo de leitura e escrita,
// ordem dos anteriores, troca de slug (novo, histórico próprio, em_uso sem escrita) e B intacto.

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

describe('leituras com escopo', () => {
  it('obterConfiguracoes lê só o salão do contexto (padrões do banco)', async () => {
    const s = await criarSalaoCompleto({ salao: { nome: 'Studio Leitura', fuso: MANAUS, gradeMin: 30, intervaloMin: 10 } });
    expect(await repos().saloes.obterConfiguracoes(ctxDoGestor(s))).toEqual({
      nome: 'Studio Leitura',
      fuso: MANAUS,
      gradeMin: 30,
      antecedenciaMin: 120,
      janelaDias: 60,
      intervaloMin: 10,
    });
    expect((await repos().saloes.obterConfiguracoes(ctxDoGestor(a))).nome).toBe('Salão Aurora');
  });

  it('salão inexistente → NaoEncontrado em leituras, trava e escrita', async () => {
    const ctx = contextoDeSistema(UUID_INEXISTENTE, 'teste');
    const r = repos();
    await expect(r.saloes.obterConfiguracoes(ctx)).rejects.toBeInstanceOf(NaoEncontrado);
    await expect(r.saloes.listarSlugs(ctx)).rejects.toBeInstanceOf(NaoEncontrado);
    await expect(r.saloes.slugAtual(ctx)).rejects.toBeInstanceOf(NaoEncontrado);
    await expect(emTransacao((t) => t.saloes.travar(ctx))).rejects.toBeInstanceOf(NaoEncontrado);
    await expect(
      r.saloes.atualizarConfiguracoes(ctx, { nome: 'x', fuso: MANAUS, gradeMin: 15, antecedenciaMin: 0, janelaDias: 1, intervaloMin: 0 }),
    ).rejects.toBeInstanceOf(NaoEncontrado);
  });

  it('listarSlugs: atual e anteriores por criado_em desc, slug asc; só do salão', async () => {
    const s = await criarSalaoCompleto();
    await c.query(`UPDATE salao_slug SET criado_em = '2026-01-01T00:00:00Z' WHERE slug = $1`, [s.slugHistorico]);
    await inserirSlug(c, s.salaoId, `${s.slugAtual}-zz`, false);
    await inserirSlug(c, s.salaoId, `${s.slugAtual}-aa`, false);
    await c.query(`UPDATE salao_slug SET criado_em = '2026-06-01T00:00:00Z' WHERE slug IN ($1, $2)`, [
      `${s.slugAtual}-zz`,
      `${s.slugAtual}-aa`,
    ]);
    const r = await repos().saloes.listarSlugs(ctxDoGestor(s));
    expect(r.atual).toBe(s.slugAtual);
    expect(r.anteriores.map((x) => x.slug)).toEqual([`${s.slugAtual}-aa`, `${s.slugAtual}-zz`, s.slugHistorico]);
    expect(r.anteriores[0].criadoEm).toBeInstanceOf(Date);
    expect(r.anteriores.map((x) => x.slug)).not.toContain(b.slugAtual);
  });

  it('listarSlugs e slugAtual sem slug atual → NaoEncontrado', async () => {
    const s = await criarSalaoCompleto();
    await c.query('UPDATE salao_slug SET atual = false WHERE salao_id = $1', [s.salaoId]);
    await expect(repos().saloes.listarSlugs(ctxDoGestor(s))).rejects.toBeInstanceOf(NaoEncontrado);
    await expect(repos().saloes.slugAtual(ctxDoGestor(s))).rejects.toBeInstanceOf(NaoEncontrado);
  });

  it('travar devolve o fuso; slugAtual devolve o atual', async () => {
    const s = await criarSalaoCompleto({ salao: { fuso: MANAUS } });
    const r = await emTransacao(async (t) => ({ trava: await t.saloes.travar(ctxDoGestor(s)), atual: await t.saloes.slugAtual(ctxDoGestor(s)) }));
    expect(r).toEqual({ trava: { fuso: MANAUS }, atual: s.slugAtual });
  });
});

describe('atualizarConfiguracoes', () => {
  it('grava os seis campos e atualizado_em só no salão do contexto; B intacto', async () => {
    const s = await criarSalaoCompleto();
    const antesB = await linhaSalao(c, b.salaoId);
    const antes = await linhaSalao(c, s.salaoId);
    await repos().saloes.atualizarConfiguracoes(ctxDoGestor(s), {
      nome: 'Novo Nome',
      fuso: MANAUS,
      gradeMin: 30,
      antecedenciaMin: 0,
      janelaDias: 365,
      intervaloMin: 120,
    });
    const depois = await linhaSalao(c, s.salaoId);
    expect(depois).toMatchObject({
      nome: 'Novo Nome',
      fuso: MANAUS,
      grade_min: 30,
      antecedencia_min: 0,
      janela_dias: 365,
      intervalo_min: 120,
    });
    expect(depois.atualizado_em).not.toBe(antes.atualizado_em);
    expect(await linhaSalao(c, b.salaoId)).toEqual(antesB);
  });
});

describe('trocarSlug (CA-1, CA-2, CA-10)', () => {
  it('novo: anterior vira histórico, novo atual, 1 atual; linha de salao intacta; B intacto', async () => {
    const s = await criarSalaoCompleto();
    const salaoAntes = await linhaSalao(c, s.salaoId);
    const bAntes = await slugsDe(c, b.salaoId);
    const novo = `${s.slugAtual}-novo`;
    const r = await emTransacao(async (t) => {
      await t.saloes.travar(ctxDoGestor(s));
      return t.saloes.trocarSlug(ctxDoGestor(s), novo);
    });
    expect(r).toBe('trocado');
    const linhas = await slugsDe(c, s.salaoId);
    expect(linhas.map(({ slug, atual }) => ({ slug, atual }))).toEqual(
      [
        { slug: s.slugAtual, atual: false },
        { slug: s.slugHistorico, atual: false },
        { slug: novo, atual: true },
      ].sort((x, y) => (x.slug < y.slug ? -1 : 1)),
    );
    expect(await atuaisDe(c, s.salaoId)).toEqual([novo]);
    expect(await linhaSalao(c, s.salaoId)).toEqual(salaoAntes);
    expect(await slugsDe(c, b.salaoId)).toEqual(bAntes);
  });

  it('histórico do próprio salão volta a ser atual sem linha nova (CA-10)', async () => {
    const s = await criarSalaoCompleto();
    const antes = await slugsDe(c, s.salaoId);
    const r = await emTransacao(async (t) => {
      await t.saloes.travar(ctxDoGestor(s));
      return t.saloes.trocarSlug(ctxDoGestor(s), s.slugHistorico);
    });
    expect(r).toBe('trocado');
    const depois = await slugsDe(c, s.salaoId);
    expect(depois).toHaveLength(antes.length);
    expect(depois.map((l) => l.criado_em)).toEqual(antes.map((l) => l.criado_em));
    expect(await atuaisDe(c, s.salaoId)).toEqual([s.slugHistorico]);
  });

  it('slug atual ou histórico de outro salão → em_uso, sem nenhuma escrita (CA-2)', async () => {
    const aAntes = await slugsDe(c, a.salaoId);
    const bAntes = await slugsDe(c, b.salaoId);
    for (const alvo of [b.slugAtual, b.slugHistorico]) {
      const r = await emTransacao(async (t) => {
        await t.saloes.travar(ctxDoGestor(a));
        return t.saloes.trocarSlug(ctxDoGestor(a), alvo);
      });
      expect(r).toBe('em_uso');
    }
    expect(await slugsDe(c, a.salaoId)).toEqual(aAntes);
    expect(await slugsDe(c, b.salaoId)).toEqual(bAntes);
  });

  it('salão sem atual → Error de invariante e a transação desfaz o INSERT', async () => {
    const s = await criarSalaoCompleto();
    await c.query('UPDATE salao_slug SET atual = false WHERE salao_id = $1', [s.salaoId]);
    const novo = `${s.slugAtual}-sem-atual`;
    await expect(
      emTransacao(async (t) => {
        await t.saloes.travar(ctxDoGestor(s));
        return t.saloes.trocarSlug(ctxDoGestor(s), novo);
      }),
    ).rejects.toThrow('esperado 1');
    expect((await slugsDe(c, s.salaoId)).map((l) => l.slug)).not.toContain(novo);
  });
});
