import type pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as acoes from '@/server/profissionais/profissionais.acao';
import { listarParaPainel, obterParaEdicao } from '@/server/profissionais/servico';
import { metadadosDaAcao } from '@/server/tenant/define-acao';
import { NaoEncontrado } from '@/server/tenant/erros';
import { resolverTenant } from '@/server/tenant/sessao';
import type { Credencial } from '@/server/tenant/sessao';

import { credencialDoGestor, credencialDoProfissional, criarSessao, criarSuperAdmin } from '../../support/auth';
import { criarDoisSaloes } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { conectar } from '../../support/sql';

import { cancelarReservasDoSalao, fotografiaDoSalao, inserirConvite } from './apoio';

// D-013 T-3: isolamento entre salões (G-4) e permissões por papel. CA-9, CA-10 e CA-11.

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
  // B com convite pendente e sessão aberta: provas de que nada de B muda.
  await cancelarReservasDoSalao(c, b.salaoId);
  await inserirConvite(c, { salaoId: b.salaoId, profissionalId: b.profissional.profissionalId, estado: 'pendente' });
  await criarSessao(b.profissional.usuarioId);
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

describe('CA-9: id de outro salão, inexistente ou malformado → 404 uniforme; B intacto', () => {
  it('CA-9: editar, desativar e reativar com esses ids devolvem nao_encontrado e não mudam B', async () => {
    const antesB = await fotografiaDoSalao(c, b.salaoId);
    const ids: unknown[] = [b.profissional.profissionalId, b.profissionalInativoId, '00000000-0000-4000-8000-000000000000', 'abc', 42, undefined];
    for (const id of ids) {
      expect(await acoes.editarProfissional.executar(gestorA, { id, nome: 'Invasora', email: 'x@exemplo.com' }), String(id)).toEqual(
        NAO_ENCONTRADO,
      );
      expect(await acoes.desativarProfissional.executar(gestorA, { id }), String(id)).toEqual(NAO_ENCONTRADO);
      expect(await acoes.reativarProfissional.executar(gestorA, { id }), String(id)).toEqual(NAO_ENCONTRADO);
    }
    expect(await acoes.desativarProfissional.executar(gestorA, null as never)).toEqual(NAO_ENCONTRADO);
    expect(await fotografiaDoSalao(c, b.salaoId)).toEqual(antesB);
  });

  it('CA-9: obterParaEdicao com id de B → NaoEncontrado (mesmo erro do inexistente)', async () => {
    const ctx = await resolverTenant(gestorA);
    for (const id of [b.profissional.profissionalId, '00000000-0000-4000-8000-000000000000', 'abc', null]) {
      await expect(obterParaEdicao(ctx, id)).rejects.toBeInstanceOf(NaoEncontrado);
    }
    expect((await obterParaEdicao(ctx, a.profissional.profissionalId)).id).toBe(a.profissional.profissionalId);
  });
});

describe('CA-10: a lista só traz o salão da sessão', () => {
  it('CA-10: o gestor de A só vê profissionais de A', async () => {
    const lista = await listarParaPainel(await resolverTenant(gestorA));
    const { rows } = await c.query('SELECT id::text AS id FROM profissional WHERE salao_id = $1', [a.salaoId]);
    expect(lista.map((p) => p.id).sort()).toEqual(rows.map((r) => r.id).sort());
    const deB = [b.gestor.profissionalId, b.profissional.profissionalId, b.profissionalInativoId];
    expect(lista.some((p) => deB.includes(p.id))).toBe(false);
  });
});

describe('CA-11: permissões por papel', () => {
  it('CA-11: profissional ativo → 403 em toda ação (inclusive sobre o próprio perfil), sem alterar o banco', async () => {
    const prof = await credencialDoProfissional(a);
    const antes = await fotografiaDoSalao(c, a.salaoId);
    const proprio = a.profissional.profissionalId;
    expect(await acoes.criarProfissional.executar(prof, { nome: 'Nova' })).toEqual(ACESSO_NEGADO);
    expect(await acoes.editarProfissional.executar(prof, { id: proprio, nome: 'Meu nome' })).toEqual(ACESSO_NEGADO);
    expect(await acoes.desativarProfissional.executar(prof, { id: proprio })).toEqual(ACESSO_NEGADO);
    expect(await acoes.reativarProfissional.executar(prof, { id: a.profissionalInativoId })).toEqual(ACESSO_NEGADO);
    expect(await acoes.euTambemAtendo.executar(prof, {})).toEqual(ACESSO_NEGADO);
    const depois = (await fotografiaDoSalao(c, a.salaoId)) as { sessoes: unknown };
    expect({ ...depois, sessoes: null }).toEqual({ ...(antes as object), sessoes: null });
  });

  it('CA-11: o serviço também recusa o profissional (defesa em profundidade)', async () => {
    const ctx = await resolverTenant(await credencialDoProfissional(a));
    await expect(listarParaPainel(ctx)).rejects.toMatchObject({ codigo: 'acesso_negado' });
    await expect(obterParaEdicao(ctx, a.profissional.profissionalId)).rejects.toMatchObject({ codigo: 'acesso_negado' });
  });

  it('CA-11: sem sessão → 401; super admin → 403', async () => {
    const admin = await criarSuperAdmin({ totpVerificado: true });
    for (const acao of [acoes.criarProfissional, acoes.editarProfissional, acoes.desativarProfissional, acoes.reativarProfissional]) {
      expect(await acao.executar(null, { id: a.profissional.profissionalId, nome: 'X' } as never)).toEqual(NAO_AUTENTICADO);
      expect(await acao.executar(admin.credencial, { id: a.profissional.profissionalId, nome: 'X' } as never)).toEqual(
        ACESSO_NEGADO,
      );
    }
    expect(await acoes.euTambemAtendo.executar(null, {})).toEqual(NAO_AUTENTICADO);
  });

  it('CA-11 (registro): as 5 ações declaram papeis [gestor] e capacidade configurar', () => {
    expect(Object.keys(acoes).sort()).toEqual([
      'criarProfissional',
      'desativarProfissional',
      'editarProfissional',
      'euTambemAtendo',
      'reativarProfissional',
    ]);
    for (const acao of Object.values(acoes)) {
      expect(metadadosDaAcao(acao)).toEqual({ papeis: ['gestor'], capacidade: 'configurar' });
    }
  });
});
