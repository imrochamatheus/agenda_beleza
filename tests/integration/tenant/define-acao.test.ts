import { randomBytes } from 'node:crypto';

import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { repos } from '@/server/repos';
import type { Capacidade, TenantContext } from '@/server/tenant/context';
import { defineAcao } from '@/server/tenant/define-acao';
import { permitirTudo } from '@/server/tenant/politica';
import type { PoliticaOperacao } from '@/server/tenant/politica';
import { resolverTenant } from '@/server/tenant/sessao';
import type { Credencial } from '@/server/tenant/sessao';

import { credencialDoGestor, credencialDoProfissional, criarSessao, criarSuperAdmin } from '../../support/auth';
import { criarSalaoCompleto } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { conectar } from '../../support/sql';

// CA-9, CA-10 e CA-11 (RN-7) pelo núcleo de defineAcao com sessões reais, e a forma chamável (usada pelo
// Next) com next/headers substituído. Substituir next/headers não é mock de banco: a sessão é lida do
// PostgreSQL real deste worker.

const cookie = vi.hoisted(() => ({ valor: undefined as string | undefined }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (nome: string) =>
      nome === 'ab_sessao' && cookie.valor !== undefined ? { name: nome, value: cookie.valor } : undefined,
  }),
}));

const HORA_MS = 60 * 60 * 1000;
const NAO_AUTENTICADO = { ok: false, erro: 'nao_autenticado', status: 401 } as const;
const ACESSO_NEGADO = { ok: false, erro: 'acesso_negado', status: 403 } as const;

let c: pg.Client;
let s: SalaoCompleto;
let semPerfil: SalaoCompleto;

beforeAll(async () => {
  c = await conectar();
  s = await criarSalaoCompleto();
  semPerfil = await criarSalaoCompleto({ gestor: { comPerfil: false } });
});
afterAll(async () => {
  await c.end();
});
beforeEach(() => {
  cookie.valor = undefined;
});

async function nomeDoServico(id: string): Promise<{ nome: string; atualizado_em: Date }> {
  const r = await c.query<{ nome: string; atualizado_em: Date }>('SELECT nome, atualizado_em FROM servico WHERE id = $1', [id]);
  return r.rows[0];
}

describe('CA-9: sessão inválida → 401; papel não permitido → 403; o handler não executa', () => {
  const handler = vi.fn(async (ctx: TenantContext) => ctx.salaoId);
  const soGestor = defineAcao({ papeis: ['gestor'], capacidade: 'configurar' }, handler);
  beforeEach(() => {
    handler.mockClear();
  });

  it('CA-9a: sem sessão (credencial nula) → NaoAutenticado/401', async () => {
    expect(await soGestor.executar(null, {})).toEqual(NAO_AUTENTICADO);
    expect(handler).not.toHaveBeenCalled();
  });

  it('CA-9b: token desconhecido → NaoAutenticado/401', async () => {
    expect(await soGestor.executar({ token: randomBytes(32).toString('base64url') }, {})).toEqual(NAO_AUTENTICADO);
    expect(handler).not.toHaveBeenCalled();
  });

  it('CA-9c: sessão expirada → NaoAutenticado/401 (inclusive no limite expira_em = agora)', async () => {
    const expirada = await criarSessao(s.gestor.usuarioId, { expiraEm: new Date(Date.now() - 1000) });
    expect(await soGestor.executar(expirada.credencial, {})).toEqual(NAO_AUTENTICADO);

    const expiraEm = new Date(Date.now() + HORA_MS);
    const noLimite = await criarSessao(s.gestor.usuarioId, { expiraEm });
    expect(await soGestor.executar(noLimite.credencial, {}, { agora: expiraEm })).toEqual(NAO_AUTENTICADO);
    // Controle: 1 ms antes do limite a mesma sessão é válida.
    expect(await soGestor.executar(noLimite.credencial, {}, { agora: new Date(expiraEm.getTime() - 1) })).toEqual({
      ok: true,
      dados: s.salaoId,
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('CA-9d: sessão revogada → NaoAutenticado/401', async () => {
    const revogada = await criarSessao(s.gestor.usuarioId, { revogadaEm: new Date() });
    expect(await soGestor.executar(revogada.credencial, {})).toEqual(NAO_AUTENTICADO);
    expect(handler).not.toHaveBeenCalled();
  });

  it('CA-9e: usuário profissional numa ação só de gestor → AcessoNegado/403', async () => {
    expect(await soGestor.executar(await credencialDoProfissional(s), {})).toEqual(ACESSO_NEGADO);
    expect(handler).not.toHaveBeenCalled();
  });

  it('CA-9f: super_admin (com ou sem TOTP) → AcessoNegado/403: não obtém TenantContext', async () => {
    for (const totpVerificado of [false, true]) {
      const admin = await criarSuperAdmin({ totpVerificado });
      expect(await soGestor.executar(admin.credencial, {})).toEqual(ACESSO_NEGADO);
      await expect(resolverTenant(admin.credencial)).rejects.toMatchObject({ codigo: 'acesso_negado', status: 403 });
    }
    expect(handler).not.toHaveBeenCalled();
  });

  it('CA-9: controle: a sessão válida do gestor executa o handler', async () => {
    expect(await soGestor.executar(await credencialDoGestor(s), {})).toEqual({ ok: true, dados: s.salaoId });
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe('CA-10: o handler recebe o TenantContext montado da sessão', () => {
  const capturar = defineAcao({ papeis: ['gestor', 'profissional'], capacidade: 'leitura' }, async (ctx) => ({ ...ctx }));

  it('CA-10: gestor com perfil de profissional vinculado', async () => {
    const r = await capturar.executar(await credencialDoGestor(s), {});
    expect(r).toEqual({
      ok: true,
      dados: {
        tipo: 'tenant',
        usuarioId: s.gestor.usuarioId,
        papel: 'gestor',
        salaoId: s.salaoId,
        profissionalId: s.gestor.profissionalId,
      },
    });
  });

  it('CA-10: profissional com usuário', async () => {
    const r = await capturar.executar(await credencialDoProfissional(s), {});
    expect(r).toEqual({
      ok: true,
      dados: {
        tipo: 'tenant',
        usuarioId: s.profissional.usuarioId,
        papel: 'profissional',
        salaoId: s.salaoId,
        profissionalId: s.profissional.profissionalId,
      },
    });
  });

  it('CA-10: gestor sem perfil vinculado → profissionalId nulo', async () => {
    const r = await capturar.executar(await credencialDoGestor(semPerfil), {});
    expect(r).toEqual({
      ok: true,
      dados: {
        tipo: 'tenant',
        usuarioId: semPerfil.gestor.usuarioId,
        papel: 'gestor',
        salaoId: semPerfil.salaoId,
        profissionalId: null,
      },
    });
  });

  it('CA-10: o contexto entregue ao handler é congelado', async () => {
    const r = await defineAcao({ papeis: ['gestor'], capacidade: 'leitura' }, async (ctx) => Object.isFrozen(ctx)).executar(
      await credencialDoGestor(s),
      {},
    );
    expect(r).toEqual({ ok: true, dados: true });
  });
});

describe('CA-11: política de operação plugável, consultada com o contexto e a capacidade', () => {
  const renomear = (capacidade: Capacidade, nome: string) =>
    defineAcao({ papeis: ['gestor'], capacidade }, (ctx, i: { id: string }) => repos().servicos.renomear(ctx, i.id, nome));

  it('CA-11: a política padrão permite todas as capacidades', async () => {
    const credencial = await credencialDoGestor(s);
    for (const capacidade of ['leitura', 'configurar', 'agendar', 'cancelar', 'assinatura', 'lgpd'] as const) {
      const r = await defineAcao({ papeis: ['gestor'], capacidade }, async () => capacidade).executar(credencial, {});
      expect(r).toEqual({ ok: true, dados: capacidade });
    }
  });

  it('CA-11: política que nega `agendar` → 403, handler não executa e o banco não muda; `cancelar` segue permitida', async () => {
    const politica = vi.fn<PoliticaOperacao>((_ctx, capacidade) =>
      capacidade === 'agendar' ? { permitido: false, motivo: 'salão suspenso' } : { permitido: true },
    );
    const credencial = await credencialDoGestor(s);
    const alvo = s.servicos.ativos[1];
    const antes = await nomeDoServico(alvo);

    const handlerAgendar = vi.fn(async (ctx: TenantContext, i: { id: string }) => repos().servicos.renomear(ctx, i.id, 'agendar'));
    const agendar = defineAcao({ papeis: ['gestor'], capacidade: 'agendar' }, handlerAgendar);
    expect(await agendar.executar(credencial, { id: alvo }, { politica })).toEqual(ACESSO_NEGADO);
    expect(handlerAgendar).not.toHaveBeenCalled();
    expect(await nomeDoServico(alvo)).toEqual(antes);

    const r = await renomear('cancelar', 'Permitido').executar(credencial, { id: alvo }, { politica });
    expect(r).toMatchObject({ ok: true, dados: { id: alvo, nome: 'Permitido' } });
    expect((await nomeDoServico(alvo)).nome).toBe('Permitido');

    // A política recebeu o TenantContext da sessão e a capacidade declarada, nas duas chamadas.
    expect(politica.mock.calls.map(([ctx, cap]) => [ctx.tipo, ctx.salaoId, ctx.usuarioId, cap])).toEqual([
      ['tenant', s.salaoId, s.gestor.usuarioId, 'agendar'],
      ['tenant', s.salaoId, s.gestor.usuarioId, 'cancelar'],
    ]);
  });

  it('CA-11: política assíncrona também é aguardada; a política não é consultada para papel recusado', async () => {
    const politica = vi.fn<PoliticaOperacao>(async () => ({ permitido: false, motivo: 'negado' }));
    const acao = defineAcao({ papeis: ['gestor'], capacidade: 'lgpd' }, async () => 'nunca');
    expect(await acao.executar(await credencialDoGestor(s), {}, { politica })).toEqual(ACESSO_NEGADO);
    expect(politica).toHaveBeenCalledTimes(1);
    expect(await acao.executar(await credencialDoProfissional(s), {}, { politica })).toEqual(ACESSO_NEGADO);
    expect(politica).toHaveBeenCalledTimes(1);
    expect(await acao.executar(await credencialDoGestor(s), {}, { politica: permitirTudo })).toEqual({
      ok: true,
      dados: 'nunca',
    });
  });

  it('CA-11: NaoEncontrado lançado pelo handler vira 404; erro que não é de domínio é relançado', async () => {
    const credencial = await credencialDoGestor(s);
    expect(await renomear('configurar', 'x').executar(credencial, { id: 'nao-e-uuid' })).toEqual({
      ok: false,
      erro: 'nao_encontrado',
      status: 404,
    });
    const falha = defineAcao({ papeis: ['gestor'], capacidade: 'configurar' }, async () => {
      throw new TypeError('defeito');
    });
    await expect(falha.executar(credencial, {})).rejects.toThrow(TypeError);
  });
});

describe('forma chamável (Next): lê o cookie ab_sessao por next/headers', () => {
  const acao = defineAcao({ papeis: ['gestor', 'profissional'], capacidade: 'leitura' }, async (ctx, i: { eco: string }) => ({
    salaoId: ctx.salaoId,
    papel: ctx.papel,
    eco: i.eco,
  }));

  it('com cookie de sessão válida → executa com o contexto da sessão', async () => {
    cookie.valor = (await criarSessao(s.profissional.usuarioId)).token;
    expect(await acao({ eco: 'oi' })).toEqual({ ok: true, dados: { salaoId: s.salaoId, papel: 'profissional', eco: 'oi' } });
  });

  it('sem cookie ou com sessão revogada → 401', async () => {
    expect(await acao({ eco: 'oi' })).toEqual(NAO_AUTENTICADO);
    cookie.valor = (await criarSessao(s.gestor.usuarioId, { revogadaEm: new Date() })).token;
    expect(await acao({ eco: 'oi' })).toEqual(NAO_AUTENTICADO);
  });

  it('a credencial do cookie é a mesma aceita pelo núcleo', async () => {
    const credencial: Credencial = await credencialDoGestor(s);
    cookie.valor = credencial?.token;
    expect(await acao({ eco: 'x' })).toEqual(await acao.executar(credencial, { eco: 'x' }));
  });
});

describe('D-013 D-15: o handler recebe o relógio da execução (exec.agora)', () => {
  it('exec.agora é o deps.agora injetado, congelado, e o mesmo instante usado em resolverTenant', async () => {
    const expiraEm = new Date(Date.now() + HORA_MS);
    const sessao = await criarSessao(s.gestor.usuarioId, { expiraEm });
    const recebidos: { agora: Date; congelado: boolean }[] = [];
    const acao = defineAcao({ papeis: ['gestor'], capacidade: 'configurar' }, async (_ctx, _i: object, exec) => {
      recebidos.push({ agora: exec.agora, congelado: Object.isFrozen(exec) });
      return exec.agora.toISOString();
    });
    // O mesmo relógio decide a sessão: no limite expira_em = agora, 401 e o handler não executa.
    expect(await acao.executar(sessao.credencial, {}, { agora: expiraEm })).toEqual(NAO_AUTENTICADO);
    expect(recebidos).toHaveLength(0);
    const antes = new Date(expiraEm.getTime() - 1);
    expect(await acao.executar(sessao.credencial, {}, { agora: antes })).toEqual({ ok: true, dados: antes.toISOString() });
    expect(recebidos).toHaveLength(1);
    expect(recebidos[0].agora).toBe(antes);
    expect(recebidos[0].congelado).toBe(true);
  });

  it('sem deps.agora → um único instante do relógio real por execução', async () => {
    let recebido: Date | undefined;
    const acao = defineAcao({ papeis: ['gestor'], capacidade: 'leitura' }, async (_ctx, _i: object, { agora }) => {
      recebido = agora;
      return null;
    });
    const antes = Date.now();
    expect(await acao.executar(await credencialDoGestor(s), {})).toEqual({ ok: true, dados: null });
    expect(recebido).toBeInstanceOf(Date);
    expect(recebido!.getTime()).toBeGreaterThanOrEqual(antes);
    expect(recebido!.getTime()).toBeLessThanOrEqual(Date.now());
  });
});
