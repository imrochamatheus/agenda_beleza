import type pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as acoes from '@/server/servicos/servicos.acao';
import { listarParaPainel, listarProfissionaisParaNovo, obterParaEdicao } from '@/server/servicos/servico';
import { metadadosDaAcao } from '@/server/tenant/define-acao';
import { NaoEncontrado } from '@/server/tenant/erros';
import { resolverTenant } from '@/server/tenant/sessao';
import type { Credencial } from '@/server/tenant/sessao';

import { credencialDoGestor, credencialDoProfissional, criarSuperAdmin } from '../../support/auth';
import { criarDoisSaloes } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { conectar } from '../../support/sql';

import { UUID_INEXISTENTE, contarServicos, fotografiaServico, vinculosDoSalao } from './apoio';

// D-014 T-3: isolamento entre salões (G-4) e permissões por papel. CA-9, CA-10 e CA-11.

const NAO_ENCONTRADO = { ok: false, erro: 'nao_encontrado', status: 404 } as const;
const ACESSO_NEGADO = { ok: false, erro: 'acesso_negado', status: 403 } as const;
const NAO_AUTENTICADO = { ok: false, erro: 'nao_autenticado', status: 401 } as const;

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
beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** Serviços e vínculos de um salão (prova de "nada mudou", inclusive atualizado_em). */
async function fotografiaDoSalao(s: SalaoCompleto): Promise<unknown> {
  const servicos = [];
  for (const id of [...s.servicos.ativos, s.servicos.inativoId]) servicos.push(await fotografiaServico(c, id));
  return { servicos, vinculos: await vinculosDoSalao(c, s.salaoId), total: await contarServicos(c, s.salaoId) };
}

describe('CA-9: id de outro salão, inexistente ou malformado → 404 uniforme; B intacto', () => {
  it('CA-9: editar, desativar e reativar com esses ids devolvem nao_encontrado e não mudam B', async () => {
    const antesB = await fotografiaDoSalao(b);
    const ids: unknown[] = [b.servicos.ativos[0], b.servicos.inativoId, UUID_INEXISTENTE, 'abc', 42, undefined];
    for (const id of ids) {
      const entrada = { id, nome: 'Invasora', preco: '1,00', duracao: '5', profissionais: [] };
      expect(await acoes.editarServico.executar(gestorA, entrada), String(id)).toEqual(NAO_ENCONTRADO);
      // Com profissionais válidos de A a precedência (D-18) também chega ao 404.
      expect(
        await acoes.editarServico.executar(gestorA, { ...entrada, profissionais: [a.profissional.profissionalId] }),
        String(id),
      ).toEqual(NAO_ENCONTRADO);
      expect(await acoes.desativarServico.executar(gestorA, { id }), String(id)).toEqual(NAO_ENCONTRADO);
      expect(await acoes.reativarServico.executar(gestorA, { id }), String(id)).toEqual(NAO_ENCONTRADO);
    }
    expect(await acoes.desativarServico.executar(gestorA, null as never)).toEqual(NAO_ENCONTRADO);
    expect(await fotografiaDoSalao(b)).toEqual(antesB);
  });

  it('D-18: entrada inválida com id de B → invalido (igual ao inexistente), sem vazar nada', async () => {
    for (const id of [b.servicos.ativos[0], UUID_INEXISTENTE]) {
      expect(await acoes.editarServico.executar(gestorA, { id, nome: '', preco: '1', duracao: '5', profissionais: [] })).toMatchObject({
        ok: true,
        dados: { resultado: 'invalido' },
      });
    }
  });

  it('CA-9: obterParaEdicao com id de B → NaoEncontrado (mesmo erro do inexistente)', async () => {
    const ctx = await resolverTenant(gestorA);
    for (const id of [b.servicos.ativos[0], UUID_INEXISTENTE, 'abc', null]) {
      await expect(obterParaEdicao(ctx, id)).rejects.toBeInstanceOf(NaoEncontrado);
    }
    expect((await obterParaEdicao(ctx, a.servicos.ativos[0])).id).toBe(a.servicos.ativos[0]);
  });
});

describe('CA-10: a lista só traz o salão da sessão', () => {
  it('CA-10: o gestor de A só vê serviços de A e a contagem é só de profissionais ativos de A', async () => {
    const ctx = await resolverTenant(gestorA);
    const lista = await listarParaPainel(ctx);
    const { rows } = await c.query('SELECT id::text AS id FROM servico WHERE salao_id = $1', [a.salaoId]);
    expect(lista.map((s) => s.id).sort()).toEqual(rows.map((r) => r.id).sort());
    const porId = new Map(lista.map((s) => [s.id, s]));
    expect(porId.get(a.servicos.ativos[0])!.profissionaisAtivos).toBe(2);
    expect(porId.get(a.servicos.inativoId)).toMatchObject({ profissionaisAtivos: 0, ofertavel: false, ativo: false });
    const novos = await listarProfissionaisParaNovo(ctx);
    expect(novos.map((p) => p.id).sort()).toEqual([a.profissional.profissionalId, a.gestor.profissionalId!].sort());
    expect(novos.every((p) => p.ativo && !p.vinculado)).toBe(true);
  });
});

describe('CA-11: permissões por papel', () => {
  it('CA-11: profissional ativo → 403 nas 4 ações, sem alterar o banco', async () => {
    const prof = await credencialDoProfissional(a);
    const antes = await fotografiaDoSalao(a);
    const id = a.servicos.ativos[0];
    expect(await acoes.criarServico.executar(prof, { nome: 'Nova', preco: '1', duracao: '5', profissionais: [] })).toEqual(ACESSO_NEGADO);
    expect(await acoes.editarServico.executar(prof, { id, nome: 'Novo', preco: '1', duracao: '5', profissionais: [] })).toEqual(
      ACESSO_NEGADO,
    );
    expect(await acoes.desativarServico.executar(prof, { id })).toEqual(ACESSO_NEGADO);
    expect(await acoes.reativarServico.executar(prof, { id: a.servicos.inativoId })).toEqual(ACESSO_NEGADO);
    expect(await fotografiaDoSalao(a)).toEqual(antes);
  });

  it('CA-11: o serviço de domínio também recusa o profissional (defesa em profundidade)', async () => {
    const ctx = await resolverTenant(await credencialDoProfissional(a));
    await expect(listarParaPainel(ctx)).rejects.toMatchObject({ codigo: 'acesso_negado' });
    await expect(obterParaEdicao(ctx, a.servicos.ativos[0])).rejects.toMatchObject({ codigo: 'acesso_negado' });
    await expect(listarProfissionaisParaNovo(ctx)).rejects.toMatchObject({ codigo: 'acesso_negado' });
  });

  it('CA-11: sem sessão → 401; super admin → 403', async () => {
    const admin = await criarSuperAdmin({ totpVerificado: true });
    const entrada = { id: a.servicos.ativos[0], nome: 'X', preco: '1', duracao: '5', profissionais: [] };
    for (const acao of [acoes.criarServico, acoes.editarServico, acoes.desativarServico, acoes.reativarServico]) {
      expect(await acao.executar(null, entrada as never)).toEqual(NAO_AUTENTICADO);
      expect(await acao.executar(admin.credencial, entrada as never)).toEqual(ACESSO_NEGADO);
    }
  });

  it('CA-11 (registro): as 4 ações declaram papeis [gestor] e capacidade configurar', () => {
    expect(Object.keys(acoes).sort()).toEqual(['criarServico', 'desativarServico', 'editarServico', 'reativarServico']);
    for (const acao of Object.values(acoes)) {
      expect(metadadosDaAcao(acao)).toEqual({ papeis: ['gestor'], capacidade: 'configurar' });
    }
  });
});
