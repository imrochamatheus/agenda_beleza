import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { repos } from '@/server/repos';
import { COLUNAS_FUNCIONAMENTO, funcionamentoDaLinha } from '@/server/repos/funcionamento';
import { lerFuncionamentoPublico, lerPerfilPublico, resolverSalaoPorSlug } from '@/server/repos/publico';
import type { PerfilDTO } from '@/server/repos/tipos';
import { emTransacao } from '@/server/repos/transacao';
import { contextoDeSistema, criarAdminContext, criarPublicoContext } from '@/server/tenant/context';
import { NaoEncontrado } from '@/server/tenant/erros';

import { criarDoisSaloes, criarSalaoCompleto } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { conectar } from '../../support/sql';

import { UUID_INEXISTENTE, ctxDoGestor, linhaSalao } from './apoio';

// D-020 T-5: RepoSalao (perfil), RepoFuncionamento e as leituras públicas contra PostgreSQL real, com
// dois salões. CA-1 (escopo), CA-14 (NULL e listas vazias), CA-15 (chave desconhecida), CA-16 (projeção),
// CA-17 (leituras), idempotência do estado (R-6) e o fragmento com linhas plantadas (A-5).

let c: pg.Client;
let a: SalaoCompleto;

const PERFIL: PerfilDTO = {
  descricao: 'Linha 1\nLinha 2',
  enderecoLogradouro: 'Av. Paulista',
  enderecoNumero: '1000',
  enderecoComplemento: null,
  enderecoBairro: 'Bela Vista',
  enderecoCidade: 'São Paulo',
  enderecoUf: 'SP',
  enderecoCep: '01310100',
  telefoneE164: '+551134567890',
  whatsappE164: '+5511987654321',
  instagram: 'meu.salao',
  meiosPagamento: ['dinheiro', 'pix'],
  comodidades: ['wifi'],
};
const VAZIO: PerfilDTO = {
  descricao: null,
  enderecoLogradouro: null,
  enderecoNumero: null,
  enderecoComplemento: null,
  enderecoBairro: null,
  enderecoCidade: null,
  enderecoUf: null,
  enderecoCep: null,
  telefoneE164: null,
  whatsappE164: null,
  instagram: null,
  meiosPagamento: [],
  comodidades: [],
};

const publico = (s: SalaoCompleto) => criarPublicoContext(s.salaoId, s.slugAtual);

async function linhasFuncionamento(salaoId: string) {
  const { rows } = await c.query<{ id: string; dia_semana: number; inicio_min: number; fim_min: number }>(
    'SELECT id::text, dia_semana, inicio_min, fim_min FROM salao_funcionamento WHERE salao_id = $1 ORDER BY dia_semana, inicio_min',
    [salaoId],
  );
  return rows;
}

beforeAll(async () => {
  c = await conectar();
  ({ a } = await criarDoisSaloes());
});
afterAll(async () => {
  await c.end();
});

describe('RepoSalao: perfil', () => {
  it('salão novo: perfil vazio; atualizarPerfil grava só no salão do contexto e não toca nome/fuso/regras', async () => {
    const s = await criarSalaoCompleto();
    expect(await repos().saloes.obterPerfil(ctxDoGestor(s))).toEqual(VAZIO);
    const antes = await linhaSalao(c, s.salaoId);
    const outro = await linhaSalao(c, a.salaoId);
    await repos().saloes.atualizarPerfil(ctxDoGestor(s), PERFIL);
    expect(await repos().saloes.obterPerfil(ctxDoGestor(s))).toEqual(PERFIL);
    const depois = await linhaSalao(c, s.salaoId);
    for (const coluna of ['nome', 'fuso', 'grade_min', 'antecedencia_min', 'janela_dias', 'intervalo_min', 'funcionamento_definido', 'suspenso_manual_em']) {
      expect(depois[coluna], coluna).toEqual(antes[coluna]);
    }
    expect(depois.atualizado_em).not.toEqual(antes.atualizado_em);
    expect(await linhaSalao(c, a.salaoId)).toEqual(outro);
  });

  it('CA-14: perfil apagado vira NULL (nunca "") e listas vazias', async () => {
    const s = await criarSalaoCompleto();
    await repos().saloes.atualizarPerfil(ctxDoGestor(s), PERFIL);
    await repos().saloes.atualizarPerfil(ctxDoGestor(s), VAZIO);
    const l = await linhaSalao(c, s.salaoId);
    for (const coluna of ['descricao', 'endereco_logradouro', 'endereco_cep', 'telefone_e164', 'whatsapp_e164', 'instagram']) {
      expect(l[coluna], coluna).toBeNull();
    }
    expect([l.meios_pagamento, l.comodidades]).toEqual([[], []]);
    expect((await lerPerfilPublico(publico(s))).endereco).toBeNull();
  });

  it('salão inexistente → NaoEncontrado', async () => {
    const ctx = contextoDeSistema(UUID_INEXISTENTE, 'teste');
    await expect(repos().saloes.obterPerfil(ctx)).rejects.toBeInstanceOf(NaoEncontrado);
    await expect(repos().saloes.atualizarPerfil(ctx, VAZIO)).rejects.toBeInstanceOf(NaoEncontrado);
  });
});

describe('RepoFuncionamento', () => {
  it('CA-6: salão novo não informado, sem linhas; ler → { definido: false, linhas: [] }', async () => {
    const s = await criarSalaoCompleto();
    expect(await repos().funcionamento.ler(ctxDoGestor(s))).toEqual({ definido: false, linhas: [] });
    expect(await emTransacao((t) => t.funcionamento.travar(ctxDoGestor(s)))).toEqual({ definido: false });
    expect(await repos().funcionamento.listar(ctxDoGestor(s))).toEqual([]);
  });

  it('aplicarDiferenca + definirEstado: escopo, ids preservados e estado só escrito quando muda', async () => {
    const s = await criarSalaoCompleto();
    const ctx = ctxDoGestor(s);
    const r = await emTransacao(async (t) => {
      await t.funcionamento.travar(ctx);
      const d = await t.funcionamento.aplicarDiferenca(ctx, {
        remover: [],
        inserir: [
          { diaSemana: 1, inicioMin: 540, fimMin: 720 },
          { diaSemana: 1, inicioMin: 780, fimMin: 1080 },
        ],
      });
      return { ...d, mudou: await t.funcionamento.definirEstado(ctx, true) };
    });
    expect(r).toEqual({ removidos: 0, inseridos: 2, mudou: true });
    const linhas = await repos().funcionamento.listar(ctx);
    expect(linhas.map((l) => [l.diaSemana, l.inicioMin, l.fimMin])).toEqual([
      [1, 540, 720],
      [1, 780, 1080],
    ]);
    expect(await repos().funcionamento.ler(ctx)).toEqual({
      definido: true,
      linhas: [
        { diaSemana: 1, inicioMin: 540, fimMin: 720 },
        { diaSemana: 1, inicioMin: 780, fimMin: 1080 },
      ],
    });

    const antes = await linhaSalao(c, s.salaoId);
    const { rows: x1 } = await c.query('SELECT xmin::text FROM salao WHERE id = $1', [s.salaoId]);
    expect(await emTransacao((t) => t.funcionamento.definirEstado(ctx, true))).toBe(false);
    const { rows: x2 } = await c.query('SELECT xmin::text FROM salao WHERE id = $1', [s.salaoId]);
    expect(x2).toEqual(x1);
    expect(await linhaSalao(c, s.salaoId)).toEqual(antes);

    // Remover id de outro salão não apaga nada (escopo).
    const deA = await c.query<{ id: string }>(
      "INSERT INTO salao_funcionamento (salao_id, dia_semana, inicio_min, fim_min) VALUES ($1, 3, 600, 700) RETURNING id::text",
      [a.salaoId],
    );
    expect(await repos().funcionamento.aplicarDiferenca(ctx, { remover: [deA.rows[0].id], inserir: [] })).toEqual({ removidos: 0, inseridos: 0 });
    expect(await linhasFuncionamento(a.salaoId)).toHaveLength(1);
    await c.query('DELETE FROM salao_funcionamento WHERE salao_id = $1', [a.salaoId]);

    const ids = linhas.map((l) => l.id);
    expect(await repos().funcionamento.aplicarDiferenca(ctx, { remover: [ids[0]], inserir: [] })).toEqual({ removidos: 1, inseridos: 0 });
    expect((await repos().funcionamento.listar(ctx)).map((l) => l.id)).toEqual([ids[1]]);
    expect(await emTransacao((t) => t.funcionamento.definirEstado(ctx, false))).toBe(true);
    expect((await linhaSalao(c, s.salaoId)).funcionamento_definido).toBe(false);
  });

  it('A-5: com definido = false e linhas plantadas, o fragmento devolve []', async () => {
    const s = await criarSalaoCompleto();
    await c.query('INSERT INTO salao_funcionamento (salao_id, dia_semana, inicio_min, fim_min) VALUES ($1, 2, 540, 600)', [s.salaoId]);
    expect(await repos().funcionamento.ler(ctxDoGestor(s))).toEqual({ definido: false, linhas: [] });
    expect(await lerFuncionamentoPublico(publico(s))).toEqual({ definido: false, linhas: [] });
    expect((await lerPerfilPublico(publico(s))).funcionamento).toBeNull();
    await c.query('UPDATE salao SET funcionamento_definido = true WHERE id = $1', [s.salaoId]);
    expect(await lerFuncionamentoPublico(publico(s))).toEqual({ definido: true, linhas: [{ diaSemana: 2, inicioMin: 540, fimMin: 600 }] });
  });

  it('salão inexistente → NaoEncontrado; AdminContext → Error', async () => {
    const ctx = contextoDeSistema(UUID_INEXISTENTE, 'teste');
    await expect(repos().funcionamento.ler(ctx)).rejects.toBeInstanceOf(NaoEncontrado);
    await expect(emTransacao((t) => t.funcionamento.travar(ctx))).rejects.toBeInstanceOf(NaoEncontrado);
    expect(await emTransacao((t) => t.funcionamento.definirEstado(ctx, true))).toBe(false);
    await expect(lerFuncionamentoPublico(criarPublicoContext(UUID_INEXISTENTE, 'x'))).rejects.toBeInstanceOf(NaoEncontrado);
    await expect(lerPerfilPublico(criarPublicoContext(UUID_INEXISTENTE, 'x'))).rejects.toBeInstanceOf(NaoEncontrado);
    await expect(repos().funcionamento.ler(criarAdminContext(a.gestor.usuarioId) as never)).rejects.toThrow(Error);
    await expect(lerPerfilPublico(ctxDoGestor(a) as never)).rejects.toThrow(Error);
  });

  it('funcionamentoDaLinha recusa forma inesperada', () => {
    expect(() => funcionamentoDaLinha({ funcionamento_definido: 'x' as never, funcionamento_linhas: [] })).toThrow(Error);
    expect(() => funcionamentoDaLinha({ funcionamento_definido: true, funcionamento_linhas: null })).toThrow(Error);
    expect(() => funcionamentoDaLinha({ funcionamento_definido: true, funcionamento_linhas: [{ diaSemana: 1.5, inicioMin: 0, fimMin: 5 }] })).toThrow(Error);
    expect(() => funcionamentoDaLinha({ funcionamento_definido: true, funcionamento_linhas: [null] })).toThrow(Error);
    expect(COLUNAS_FUNCIONAMENTO.sql).toContain('AND s.funcionamento_definido');
  });
});

describe('leitura pública do perfil (CA-1, CA-15, CA-16)', () => {
  it('projeção exata; só S1 muda; chave desconhecida ignorada; suspenso continua visível', async () => {
    const { a: s1, b: s2 } = await criarDoisSaloes();
    await repos().saloes.atualizarPerfil(ctxDoGestor(s1), PERFIL);
    await c.query(`UPDATE salao SET meios_pagamento = '{cheque,pix,dinheiro}', suspenso_manual_em = now() WHERE id = $1`, [s1.salaoId]);
    const { contexto } = await resolverSalaoPorSlug(s1.slugAtual);
    const p = await lerPerfilPublico(contexto);
    expect(Object.keys(p).sort()).toEqual(
      ['comodidades', 'descricao', 'endereco', 'funcionamento', 'instagram', 'meiosPagamento', 'nome', 'telefoneE164', 'whatsappE164'].sort(),
    );
    expect(p).toEqual({
      nome: s1.nome,
      descricao: 'Linha 1\nLinha 2',
      endereco: { logradouro: 'Av. Paulista', numero: '1000', complemento: null, bairro: 'Bela Vista', cidade: 'São Paulo', uf: 'SP', cep: '01310100' },
      telefoneE164: '+551134567890',
      whatsappE164: '+5511987654321',
      instagram: 'meu.salao',
      meiosPagamento: ['dinheiro', 'pix'],
      comodidades: ['wifi'],
      funcionamento: null,
    });
    expect(Object.keys(p.endereco!).sort()).toEqual(['bairro', 'cep', 'cidade', 'complemento', 'logradouro', 'numero', 'uf']);
    const p2 = await lerPerfilPublico((await resolverSalaoPorSlug(s2.slugAtual)).contexto);
    expect(p2).toEqual({ nome: s2.nome, descricao: null, endereco: null, telefoneE164: null, whatsappE164: null, instagram: null, meiosPagamento: [], comodidades: [], funcionamento: null });
  });

  it('funcionamento informado vem montado (7 dias, pausas); informado e vazio → 7 dias fechados', async () => {
    const s = await criarSalaoCompleto();
    await c.query('UPDATE salao SET funcionamento_definido = true WHERE id = $1', [s.salaoId]);
    const vazio = (await lerPerfilPublico(publico(s))).funcionamento!;
    expect(vazio).toHaveLength(7);
    expect(vazio.every((d) => d.intervalos.length === 0)).toBe(true);
    await c.query(
      'INSERT INTO salao_funcionamento (salao_id, dia_semana, inicio_min, fim_min) VALUES ($1, 1, 780, 1080), ($1, 1, 540, 720)',
      [s.salaoId],
    );
    const semana = (await lerPerfilPublico(publico(s))).funcionamento!;
    expect(semana[1]).toEqual({
      diaSemana: 1,
      intervalos: [
        { inicioMin: 540, fimMin: 720 },
        { inicioMin: 780, fimMin: 1080 },
      ],
      pausas: [{ inicioMin: 720, fimMin: 780 }],
    });
  });
});

describe('isolamento S1 × S2 nas leituras do funcionamento (CA-17)', () => {
  it('S1 informado e S2 não informado dão resultados distintos', async () => {
    const { a: s1, b: s2 } = await criarDoisSaloes();
    await c.query('UPDATE salao SET funcionamento_definido = true WHERE id = $1', [s1.salaoId]);
    await c.query('INSERT INTO salao_funcionamento (salao_id, dia_semana, inicio_min, fim_min) VALUES ($1, 3, 600, 960)', [s1.salaoId]);
    expect(await repos().funcionamento.ler(ctxDoGestor(s1))).toEqual({ definido: true, linhas: [{ diaSemana: 3, inicioMin: 600, fimMin: 960 }] });
    expect(await repos().funcionamento.ler(contextoDeSistema(s1.salaoId, 'teste'))).toEqual({ definido: true, linhas: [{ diaSemana: 3, inicioMin: 600, fimMin: 960 }] });
    expect(await repos().funcionamento.ler(ctxDoGestor(s2))).toEqual({ definido: false, linhas: [] });
    expect(await lerFuncionamentoPublico(publico(s2))).toEqual({ definido: false, linhas: [] });
  });
});
