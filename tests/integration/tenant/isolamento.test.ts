import { randomUUID } from 'node:crypto';

import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { repos } from '@/server/repos';
import { defineAcao } from '@/server/tenant/define-acao';
import type { ResultadoAcao } from '@/server/tenant/define-acao';
import { NaoEncontrado, respostaDeErro } from '@/server/tenant/erros';
import type { Credencial } from '@/server/tenant/sessao';

import { credencialDoGestor } from '../../support/auth';
import { criarDoisSaloes } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { conectar } from '../../support/sql';

// CA-1, CA-2, CA-7 e CA-8 (RN-1, RN-2, RN-8, RN-9), por agregado. Os dados vêm SÓ das fábricas (CA-3).
// "Pela ação": núcleo de defineAcao com a credencial real do gestor do salão A (sessão na tabela `sessao`).
// As leituras de conferência são SELECT direto pelo driver pg, independentes dos repositórios.

type Entrada = { id: string; salaoId?: string };

const NAO_ENCONTRADO = { ok: false, erro: 'nao_encontrado', status: 404 } as const;

// Ações de teste: o handler chama o repositório real com o contexto que defineAcao montou da sessão.
const ler = {
  servico: defineAcao({ papeis: ['gestor'], capacidade: 'leitura' }, (ctx, i: Entrada) =>
    repos().servicos.buscarPorId(ctx, i.id),
  ),
  profissional: defineAcao({ papeis: ['gestor'], capacidade: 'leitura' }, (ctx, i: Entrada) =>
    repos().profissionais.buscarPorId(ctx, i.id),
  ),
  cliente: defineAcao({ papeis: ['gestor'], capacidade: 'leitura' }, (ctx, i: Entrada) =>
    repos().clientes.buscarPorId(ctx, i.id),
  ),
  reserva: defineAcao({ papeis: ['gestor'], capacidade: 'leitura' }, (ctx, i: Entrada) =>
    repos().reservas.buscarPorId(ctx, i.id),
  ),
};

const NOVO_NOME = 'Nome alterado pelo teste';
const alterar = {
  servico: defineAcao({ papeis: ['gestor'], capacidade: 'configurar' }, (ctx, i: Entrada) =>
    repos().servicos.renomear(ctx, i.id, NOVO_NOME),
  ),
  profissional: defineAcao({ papeis: ['gestor'], capacidade: 'configurar' }, (ctx, i: Entrada) =>
    repos().profissionais.renomear(ctx, i.id, NOVO_NOME),
  ),
  cliente: defineAcao({ papeis: ['gestor'], capacidade: 'configurar' }, (ctx, i: Entrada) =>
    repos().clientes.renomear(ctx, i.id, NOVO_NOME),
  ),
  // Primitiva de persistência (S-9): sem ação de produto; exercitada aqui por uma ação de teste.
  reserva: defineAcao({ papeis: ['gestor'], capacidade: 'cancelar' }, (ctx, i: Entrada) =>
    repos().reservas.atualizarStatus(ctx, i.id, { de: 'confirmado', para: 'concluido' }),
  ),
};

const listar = defineAcao({ papeis: ['gestor'], capacidade: 'leitura' }, async (ctx) => {
  const r = repos();
  return {
    servicos: (await r.servicos.listar(ctx)).map((s) => s.id),
    profissionais: (await r.profissionais.listar(ctx)).map((p) => p.id),
    clientes: (await r.clientes.listar(ctx)).map((c) => c.id),
    reservas: (
      await r.reservas.listarPorPeriodo(ctx, { de: new Date(0), ate: new Date('2100-01-01T00:00:00Z') })
    ).map((x) => x.id),
  };
});

type Agregado = keyof typeof ler;
const TABELA: Record<Agregado, string> = {
  servico: 'servico',
  profissional: 'profissional',
  cliente: 'cliente',
  reserva: 'reserva',
};

let c: pg.Client;
let a: SalaoCompleto;
let b: SalaoCompleto;
let gestorA: Credencial;

beforeAll(async () => {
  c = await conectar();
  ({ a, b } = await criarDoisSaloes());
  gestorA = await credencialDoGestor(a);
});
afterAll(async () => {
  await c.end();
});

/** ID do recurso de cada agregado de um salão (o alvo das leituras e mutações). */
function idDe(s: SalaoCompleto, agregado: Agregado): string {
  return {
    servico: s.servicos.ativos[0],
    profissional: s.profissional.profissionalId,
    cliente: s.clientes.ativaId,
    reserva: s.reserva.id,
  }[agregado];
}

/** Valores de B que nunca podem aparecer numa resposta ao gestor de A. */
function valoresDeB(): string[] {
  return [
    b.salaoId,
    b.nome,
    b.slugAtual,
    b.gestor.nome,
    b.gestor.email,
    b.profissional.nome,
    b.profissional.email,
    b.profissional.profissionalId,
    ...b.servicos.ativos,
    ...b.servicos.nomes,
    b.clientes.ativaId,
    b.clientes.nomeAtiva,
    b.clientes.telefoneAtiva,
    b.reserva.id,
  ];
}

/** Linha completa (todas as colunas, inclusive atualizado_em), lida por SQL direto. */
async function linha(agregado: Agregado, id: string): Promise<Record<string, unknown>> {
  const r = await c.query<{ l: Record<string, unknown> }>(
    `SELECT to_jsonb(t) AS l FROM ${TABELA[agregado]} t WHERE id = $1`,
    [id],
  );
  expect(r.rowCount).toBe(1);
  return r.rows[0].l;
}

const AGREGADOS: Agregado[] = ['servico', 'profissional', 'cliente', 'reserva'];

describe('CA-1: leitura por ID de recurso do salão B → 404 sem dados de B', () => {
  it.each(AGREGADOS)('CA-1 (%s): o gestor de A lê o próprio recurso (controle)', async (agregado) => {
    const r = await ler[agregado].executar(gestorA, { id: idDe(a, agregado) });
    expect(r.ok).toBe(true);
    expect((r as { dados: { id: string } }).dados.id).toBe(idDe(a, agregado));
  });

  it.each(AGREGADOS)('CA-1 (%s): o gestor de A pede o ID de B e recebe NaoEncontrado/404', async (agregado) => {
    const r = await ler[agregado].executar(gestorA, { id: idDe(b, agregado) });
    expect(r).toEqual(NAO_ENCONTRADO);
    const corpo = JSON.stringify(r);
    for (const v of valoresDeB()) {
      expect(corpo).not.toContain(v);
    }
  });

  it.each(AGREGADOS)('CA-1 (%s): o repositório lança NaoEncontrado, mapeado para 404 com corpo constante', async (agregado) => {
    const ctx = await resolverCtxDoGestorA();
    const r = repos();
    const repo = { servico: r.servicos, profissional: r.profissionais, cliente: r.clientes, reserva: r.reservas }[agregado];
    const erro = await repo.buscarPorId(ctx, idDe(b, agregado)).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(NaoEncontrado);
    const e = erro as NaoEncontrado;
    expect(respostaDeErro(e)).toEqual({ status: 404, corpo: { erro: 'nao_encontrado' } });
    for (const v of valoresDeB()) {
      expect(e.message).not.toContain(v);
    }
  });
});

describe('CA-2: mutação por ID de recurso do salão B não ocorre', () => {
  it.each(AGREGADOS)('CA-2 (%s): NaoEncontrado/404 e a linha de B fica idêntica (todas as colunas)', async (agregado) => {
    const id = idDe(b, agregado);
    const antes = await linha(agregado, id);
    const r = await alterar[agregado].executar(gestorA, { id });
    expect(r).toEqual(NAO_ENCONTRADO);
    expect(await linha(agregado, id)).toEqual(antes);
  });

  it.each(AGREGADOS)('CA-2 (%s): controle: a mesma ação altera o recurso de A', async (agregado) => {
    const id = idDe(a, agregado);
    const antes = await linha(agregado, id);
    const r = (await alterar[agregado].executar(gestorA, { id })) as ResultadoAcao<Record<string, unknown>>;
    expect(r.ok).toBe(true);
    const depois = await linha(agregado, id);
    expect(depois).not.toEqual(antes);
    if (agregado === 'reserva') {
      expect(depois.status).toBe('concluido');
      expect((r as unknown as { dados: { status: string } }).dados.status).toBe('concluido');
    } else {
      expect(depois.nome).toBe(NOVO_NOME);
      expect((r as unknown as { dados: { nome: string } }).dados.nome).toBe(NOVO_NOME);
    }
    expect(depois.salao_id).toBe(a.salaoId);
  });

  it('CA-2: renomear a cliente anonimizada do próprio salão também é NaoEncontrado (predicado)', async () => {
    const antes = await linha('cliente', a.clientes.anonimizadaId);
    const r = await alterar.cliente.executar(gestorA, { id: a.clientes.anonimizadaId });
    expect(r).toEqual(NAO_ENCONTRADO);
    expect(await linha('cliente', a.clientes.anonimizadaId)).toEqual(antes);
  });

  it('CA-2: atualizarStatus com `de` diferente do status atual é NaoEncontrado e não altera', async () => {
    const ctx = await resolverCtxDoGestorA();
    const antes = await linha('reserva', b.reserva.id);
    await expect(
      repos().reservas.atualizarStatus(ctx, b.reserva.id, { de: 'cancelado', para: 'confirmado' }),
    ).rejects.toBeInstanceOf(NaoEncontrado);
    expect(await linha('reserva', b.reserva.id)).toEqual(antes);
  });
});

describe('CA-7: salaoId no input é ignorado; listagens só trazem registros de A', () => {
  it.each(AGREGADOS)('CA-7 (%s): o campo extra salaoId de B não muda o resultado da leitura', async (agregado) => {
    const semCampo = await ler[agregado].executar(gestorA, { id: idDe(a, agregado) });
    const comCampo = await ler[agregado].executar(gestorA, { id: idDe(a, agregado), salaoId: b.salaoId });
    expect(comCampo).toEqual(semCampo);
    expect(comCampo.ok).toBe(true);

    const deBSemCampo = await ler[agregado].executar(gestorA, { id: idDe(b, agregado) });
    const deBComCampo = await ler[agregado].executar(gestorA, { id: idDe(b, agregado), salaoId: b.salaoId });
    expect(deBComCampo).toEqual(deBSemCampo);
    expect(deBComCampo).toEqual(NAO_ENCONTRADO);
  });

  it('CA-7: mutação com salaoId de B no input não altera B', async () => {
    const antes = await linha('servico', b.servicos.ativos[1]);
    const r = await alterar.servico.executar(gestorA, { id: b.servicos.ativos[1], salaoId: b.salaoId });
    expect(r).toEqual(NAO_ENCONTRADO);
    expect(await linha('servico', b.servicos.ativos[1])).toEqual(antes);
  });

  it('CA-7: listagens de serviços, profissionais, clientes e reservas devolvem só A (com e sem salaoId de B)', async () => {
    const semCampo = await listar.executar(gestorA, {});
    const comCampo = await listar.executar(gestorA, { salaoId: b.salaoId });
    expect(comCampo).toEqual(semCampo);
    expect(semCampo.ok).toBe(true);
    const dados = (semCampo as { dados: Record<string, string[]> }).dados;
    // Equipe vê inativos e anonimizadas do próprio salão (RN-16).
    expect(new Set(dados.servicos)).toEqual(new Set([...a.servicos.ativos, a.servicos.inativoId]));
    expect(new Set(dados.profissionais)).toEqual(
      new Set([a.gestor.profissionalId, a.profissional.profissionalId, a.profissionalInativoId]),
    );
    expect(dados.clientes).toEqual([a.clientes.ativaId, a.clientes.anonimizadaId]);
    expect(dados.reservas).toEqual([a.reserva.id]);
    const corpo = JSON.stringify(semCampo);
    for (const v of valoresDeB()) {
      expect(corpo).not.toContain(v);
    }
  });

  it('CA-7: a listagem de reservas respeita o período [de, ate)', async () => {
    const ctx = await resolverCtxDoGestorA();
    const r = repos().reservas;
    const inicio = a.reserva.inicio;
    expect((await r.listarPorPeriodo(ctx, { de: inicio, ate: new Date(inicio.getTime() + 1) })).map((x) => x.id)).toEqual([
      a.reserva.id,
    ]);
    expect(await r.listarPorPeriodo(ctx, { de: new Date(0), ate: inicio })).toEqual([]);
  });
});

describe('CA-8: inexistente, de outro salão e malformado são indistinguíveis', () => {
  const malformados = ['nao-e-uuid', '', "1' OR '1'='1", '00000000-0000-0000-0000-00000000000g'];

  it.each(AGREGADOS)('CA-8 (%s): leitura devolve o mesmo resultado nos três casos', async (agregado) => {
    const inexistente = await ler[agregado].executar(gestorA, { id: randomUUID() });
    const deB = await ler[agregado].executar(gestorA, { id: idDe(b, agregado) });
    expect(inexistente).toEqual(NAO_ENCONTRADO);
    expect(deB).toEqual(inexistente);
    for (const id of malformados) {
      expect(await ler[agregado].executar(gestorA, { id })).toEqual(inexistente);
    }
  });

  it.each(AGREGADOS)('CA-8 (%s): mutação devolve o mesmo resultado nos três casos (sem 500 nem 22P02)', async (agregado) => {
    const inexistente = await alterar[agregado].executar(gestorA, { id: randomUUID() });
    expect(inexistente).toEqual(NAO_ENCONTRADO);
    expect(await alterar[agregado].executar(gestorA, { id: idDe(b, agregado) })).toEqual(inexistente);
    for (const id of malformados) {
      // Se o driver lançasse 22P02, o erro não seria de domínio e executar o relançaria (a promessa rejeitaria).
      expect(await alterar[agregado].executar(gestorA, { id })).toEqual(inexistente);
    }
  });

  it('CA-8: os três erros têm mesma mensagem e mesmo corpo', async () => {
    const ctx = await resolverCtxDoGestorA();
    const r = repos().servicos;
    const erros = await Promise.all(
      [randomUUID(), b.servicos.ativos[0], 'nao-e-uuid'].map((id) => r.buscarPorId(ctx, id).catch((e: unknown) => e)),
    );
    for (const e of erros) {
      expect(e).toBeInstanceOf(NaoEncontrado);
      expect((e as NaoEncontrado).message).toBe('Recurso não encontrado');
      expect(respostaDeErro(e as NaoEncontrado)).toEqual({ status: 404, corpo: { erro: 'nao_encontrado' } });
    }
  });
});

/** TenantContext do gestor de A, obtido pela mesma ação (nunca montado à mão). */
async function resolverCtxDoGestorA() {
  const r = await capturarCtx.executar(gestorA, {});
  if (!r.ok) throw new Error('sessão do gestor de A deveria ser válida');
  return r.dados;
}
const capturarCtx = defineAcao({ papeis: ['gestor'], capacidade: 'leitura' }, async (ctx) => ctx);
