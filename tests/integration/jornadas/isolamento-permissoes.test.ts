import type pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as acoes from '@/server/jornadas/jornadas.acao';
import { lerSemana } from '@/server/jornadas/leitura';
import { obter } from '@/server/jornadas/servico';
import { contextoDeSistema } from '@/server/tenant/context';
import { metadadosDaAcao } from '@/server/tenant/define-acao';
import { AcessoNegado, NaoEncontrado } from '@/server/tenant/erros';
import { resolverTenant } from '@/server/tenant/sessao';
import type { Credencial } from '@/server/tenant/sessao';

import { credencialDoGestor, credencialDoProfissional, criarSuperAdmin } from '../../support/auth';
import { criarDoisSaloes, criarSalaoCompleto } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { conectar } from '../../support/sql';

import { UUID_INEXISTENTE, apagarJornada, faixasJornada, jornadaDoSalao, semana } from './apoio';

// D-015 T-3: isolamento entre salões (G-4) e permissões por papel. CA-3, CA-11, CA-12, CA-15 (serviço)
// e CA-19, mais obter/lerSemana.

const NAO_ENCONTRADO = { ok: false, erro: 'nao_encontrado', status: 404 } as const;
const ACESSO_NEGADO = { ok: false, erro: 'acesso_negado', status: 403 } as const;
const NAO_AUTENTICADO = { ok: false, erro: 'nao_autenticado', status: 401 } as const;
const UMA_SEGUNDA = { 1: [['10:00', '11:00']] as [string, string][] };

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

describe('CA-3: só o gestor salva', () => {
  it('CA-3: profissional (a própria ou a de outro) → 403, sem escrita', async () => {
    const prof = await credencialDoProfissional(a);
    const antes = await jornadaDoSalao(c, a.salaoId);
    for (const id of [a.profissional.profissionalId, a.gestor.profissionalId!]) {
      expect(await acoes.salvarJornada.executar(prof, semana(id, UMA_SEGUNDA))).toEqual(ACESSO_NEGADO);
    }
    expect(await jornadaDoSalao(c, a.salaoId)).toEqual(antes);
  });

  it('CA-3: super admin → 403; sem credencial → 401; nada gravado', async () => {
    const admin = await criarSuperAdmin({ totpVerificado: true });
    const antes = await jornadaDoSalao(c, a.salaoId);
    const entrada = semana(a.profissional.profissionalId, UMA_SEGUNDA);
    expect(await acoes.salvarJornada.executar(admin.credencial, entrada)).toEqual(ACESSO_NEGADO);
    expect(await acoes.salvarJornada.executar(null, entrada)).toEqual(NAO_AUTENTICADO);
    expect(await jornadaDoSalao(c, a.salaoId)).toEqual(antes);
  });

  it('CA-19: a única ação exportada declara papeis [gestor] e capacidade configurar', () => {
    expect(Object.keys(acoes)).toEqual(['salvarJornada']);
    expect(metadadosDaAcao(acoes.salvarJornada)).toEqual({ papeis: ['gestor'], capacidade: 'configurar' });
  });
});

describe('CA-11: outro salão, inexistente ou malformado → 404; B intacto', () => {
  it('CA-11: salvar com esses ids → nao_encontrado e as linhas de B ficam idênticas', async () => {
    const antesB = await jornadaDoSalao(c, b.salaoId);
    for (const id of [b.profissional.profissionalId, b.gestor.profissionalId!, UUID_INEXISTENTE, 'abc']) {
      expect(await acoes.salvarJornada.executar(gestorA, semana(id, UMA_SEGUNDA)), id).toEqual(NAO_ENCONTRADO);
      expect(await acoes.salvarJornada.executar(gestorA, semana(id)), id).toEqual(NAO_ENCONTRADO);
    }
    expect(await jornadaDoSalao(c, b.salaoId)).toEqual(antesB);
  });

  it('CA-11: salaoId/profissionalId extras no corpo não mudam o alvo (formulario, nada gravado)', async () => {
    const antesA = await jornadaDoSalao(c, a.salaoId);
    const antesB = await jornadaDoSalao(c, b.salaoId);
    const entrada = { ...semana(a.profissional.profissionalId, UMA_SEGUNDA), salaoId: b.salaoId };
    expect(await acoes.salvarJornada.executar(gestorA, entrada)).toMatchObject({ ok: true, dados: { resultado: 'invalido', erros: { formulario: expect.any(String) } } });
    const comDia = semana(a.profissional.profissionalId, UMA_SEGUNDA);
    (comDia.dias[1] as Record<string, unknown>).profissionalId = b.profissional.profissionalId;
    expect(await acoes.salvarJornada.executar(gestorA, comDia)).toMatchObject({ ok: true, dados: { resultado: 'invalido' } });
    expect(await jornadaDoSalao(c, a.salaoId)).toEqual(antesA);
    expect(await jornadaDoSalao(c, b.salaoId)).toEqual(antesB);
  });

  it('precedência validação → 404 (D-014 D-18): entrada inválida com id de B → invalido, sem vazar', async () => {
    for (const id of [b.profissional.profissionalId, UUID_INEXISTENTE]) {
      expect(await acoes.salvarJornada.executar(gestorA, semana(id, { 1: [['22:00', '02:00']] }))).toMatchObject({
        ok: true,
        dados: { resultado: 'invalido' },
      });
    }
  });
});

describe('CA-12: gestor que atende e o profissional', () => {
  it('CA-12: o gestor com perfil de profissional salva a própria jornada', async () => {
    const s = await criarSalaoCompleto();
    const id = s.gestor.profissionalId!;
    expect(await acoes.salvarJornada.executar(await credencialDoGestor(s), semana(id, UMA_SEGUNDA))).toMatchObject({
      ok: true,
      dados: { resultado: 'salvo' },
    });
    expect(await faixasJornada(c, id)).toEqual([[1, 600, 660]]);
  });

  it('CA-12: obter — profissional vê a própria (não editável); outro do salão → 403; outro salão → 404', async () => {
    const ctx = await resolverTenant(await credencialDoProfissional(a));
    const visao = await obter(ctx, a.profissional.profissionalId);
    expect(visao.editavel).toBe(false);
    expect(visao.profissional).toEqual({ id: a.profissional.profissionalId, nome: a.profissional.nome, ativo: true });
    expect(visao.semana[1].intervalos).toEqual([
      { inicioMin: 540, fimMin: 720 },
      { inicioMin: 780, fimMin: 1080 },
    ]);
    await expect(obter(ctx, a.gestor.profissionalId)).rejects.toBeInstanceOf(AcessoNegado);
    await expect(obter(ctx, a.profissionalInativoId)).rejects.toBeInstanceOf(AcessoNegado);
    for (const id of [b.profissional.profissionalId, UUID_INEXISTENTE, 'abc', 42]) {
      await expect(obter(ctx, id)).rejects.toBeInstanceOf(NaoEncontrado);
    }
  });

  it('obter — gestor vê qualquer profissional do salão (editável); B, inexistente ou malformado → 404', async () => {
    const ctx = await resolverTenant(gestorA);
    const visao = await obter(ctx, a.profissionalInativoId);
    expect(visao).toMatchObject({ editavel: true, profissional: { ativo: false } });
    for (const id of [b.profissional.profissionalId, UUID_INEXISTENTE, 'abc', undefined]) {
      await expect(obter(ctx, id)).rejects.toBeInstanceOf(NaoEncontrado);
    }
  });

  it('CA-15: sem nenhum intervalo → semIntervalos (gestor e o próprio profissional)', async () => {
    const s = await criarSalaoCompleto();
    await apagarJornada(c, s.profissional.profissionalId);
    for (const credencial of [await credencialDoGestor(s), await credencialDoProfissional(s)]) {
      const visao = await obter(await resolverTenant(credencial), s.profissional.profissionalId);
      expect(visao.semIntervalos).toBe(true);
      expect(visao.semana.every((d) => d.intervalos.length === 0)).toBe(true);
    }
    expect((await obter(await resolverTenant(await credencialDoGestor(s)), s.gestor.profissionalId)).semIntervalos).toBe(false);
  });
});

describe('lerSemana (uso interno da E3.1)', () => {
  it('aceita SistemaContext, filtra pelo salão e devolve 7 dias canônicos', async () => {
    const semanaA = await lerSemana(contextoDeSistema(a.salaoId, 'worker'), a.profissional.profissionalId);
    expect(semanaA).toHaveLength(7);
    expect(semanaA[0].intervalos).toEqual([]);
    expect(semanaA[6].pausas).toEqual([{ inicioMin: 720, fimMin: 780 }]);
    // Profissional de B no contexto de A → semana vazia (quem chama confere o profissional).
    const cruzada = await lerSemana(contextoDeSistema(a.salaoId, 'worker'), b.profissional.profissionalId);
    expect(cruzada.every((d) => d.intervalos.length === 0)).toBe(true);
  });
});
