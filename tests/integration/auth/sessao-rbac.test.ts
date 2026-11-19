import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { encerrarSessao, gerarToken, iniciarSessao, revogarSessoesDoUsuario } from '@/server/auth/sessao';
import { repos } from '@/server/repos';
import type { TenantContext } from '@/server/tenant/context';
import { defineAcao } from '@/server/tenant/define-acao';
import { NaoAutenticado } from '@/server/tenant/erros';
import { exigirContexto } from '@/server/tenant/next';
import { hashDoToken, resolverTenant } from '@/server/tenant/sessao';

import { entrarDeVerdade } from '../../support/auth';
import { criarDoisSaloes, criarSalaoCompleto } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { conectar } from '../../support/sql';
import { acaoValida } from '../tenant/fixtures/registro/valida.acao';

// D-010 T-3 (nome da issue): CA-1 (núcleo), CA-3, CA-4 (núcleo), CA-5 e CA-17 com LOGIN REAL
// (serviço `entrar`, hash argon2id real), contra o PostgreSQL real. next/headers é substituído só
// para exigirContexto() ler o cookie (não é mock de banco).

const cookie = vi.hoisted(() => ({ valor: undefined as string | undefined }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (nome: string) =>
      nome === 'ab_sessao' && cookie.valor !== undefined ? { name: nome, value: cookie.valor } : undefined,
  }),
}));

const DIA = 24 * 60 * 60 * 1000;
const NAO_AUTENTICADO = { ok: false, erro: 'nao_autenticado', status: 401 } as const;
const ACESSO_NEGADO = { ok: false, erro: 'acesso_negado', status: 403 } as const;
const NAO_ENCONTRADO = { ok: false, erro: 'nao_encontrado', status: 404 } as const;

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
beforeEach(() => {
  cookie.valor = undefined;
});

async function sessaoDoToken(token: string) {
  const r = await c.query<{
    usuario_id: string;
    token_hash: string;
    revogada_em: Date | null;
    expira_em: Date;
    criado_em: Date;
    ultimo_uso_em: Date | null;
  }>('SELECT usuario_id, token_hash, revogada_em, expira_em, criado_em, ultimo_uso_em FROM sessao WHERE token_hash = $1', [
    hashDoToken(token),
  ]);
  return r.rows[0];
}

async function nomeDoProfissional(id: string): Promise<string> {
  return (await c.query<{ nome: string }>('SELECT nome FROM profissional WHERE id = $1', [id])).rows[0].nome;
}

describe('CA-1: login do gestor cria sessão no servidor referenciada só pelo hash', () => {
  it('CA-1: linha nova em sessao com token_hash, expira_em = agora + 7 d; resolverTenant devolve o gestor', async () => {
    const agora = new Date();
    const { token } = await entrarDeVerdade(a.gestor.email, { agora });
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const linha = await sessaoDoToken(token);
    expect(linha).toEqual({
      usuario_id: a.gestor.usuarioId,
      token_hash: hashDoToken(token),
      revogada_em: null,
      expira_em: new Date(agora.getTime() + 7 * DIA),
      criado_em: agora,
      ultimo_uso_em: agora,
    });
    expect(linha.token_hash).not.toBe(token);
    const ctx = await resolverTenant({ token });
    expect({ papel: ctx.papel, salaoId: ctx.salaoId, usuarioId: ctx.usuarioId }).toEqual({
      papel: 'gestor',
      salaoId: a.salaoId,
      usuarioId: a.gestor.usuarioId,
    });
  });

  it('RN-9: cada login gera um token novo (várias sessões por usuário); gerarToken é aleatório', async () => {
    const t1 = (await entrarDeVerdade(a.gestor.email)).token;
    const t2 = (await entrarDeVerdade(a.gestor.email)).token;
    expect(t1).not.toBe(t2);
    expect(new Set(Array.from({ length: 50 }, gerarToken)).size).toBe(50);
    const { token } = await iniciarSessao(a.gestor.usuarioId, new Date());
    expect((await sessaoDoToken(token)).usuario_id).toBe(a.gestor.usuarioId);
  });
});

describe('CA-3: profissional autenticado chamando ação só de gestor → 403 e nada muda', () => {
  const handler = vi.fn(async (ctx: TenantContext, input: { id: string; nome: string }) =>
    (await repos().profissionais.renomear(ctx, input.id, input.nome)).nome,
  );
  // Ação de teste definida aqui (não em fixtures/registro, que o CA-4 da D-005 lista exatamente).
  const renomearSoGestor = defineAcao({ papeis: ['gestor'], capacidade: 'configurar' }, handler);

  it('CA-3: acaoValida (fixture gestor-only) → 403 com o token do login real do profissional', async () => {
    const { credencial } = await entrarDeVerdade(a.profissional.email);
    expect(await acaoValida.executar(credencial, undefined)).toEqual(ACESSO_NEGADO);
  });

  it('CA-3: ação gestor-only que renomeia → 403, handler não chamado, nome intacto; gestor (controle) → ok', async () => {
    handler.mockClear();
    const alvo = a.profissional.profissionalId;
    const original = await nomeDoProfissional(alvo);

    const prof = await entrarDeVerdade(a.profissional.email);
    expect(await renomearSoGestor.executar(prof.credencial, { id: alvo, nome: 'Invasão' })).toEqual(ACESSO_NEGADO);
    expect(handler).not.toHaveBeenCalled();
    expect(await nomeDoProfissional(alvo)).toBe(original);

    const gestor = await entrarDeVerdade(a.gestor.email);
    expect(await renomearSoGestor.executar(gestor.credencial, { id: alvo, nome: 'Renomeada pelo gestor' })).toEqual({
      ok: true,
      dados: 'Renomeada pelo gestor',
    });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(await nomeDoProfissional(alvo)).toBe('Renomeada pelo gestor');
    await c.query('UPDATE profissional SET nome = $2 WHERE id = $1', [alvo, original]);
  });
});

describe('CA-4: depois do logout, o cookie antigo é tratado como não autenticado', () => {
  const lerPapel = defineAcao({ papeis: ['gestor', 'profissional'], capacidade: 'leitura' }, async (ctx: TenantContext) => ctx.papel);

  it('CA-4: logout de X revoga X (401 em resolverTenant, defineAcao e exigirContexto) e mantém Y', async () => {
    const x = await entrarDeVerdade(a.gestor.email);
    const y = await entrarDeVerdade(a.gestor.email);
    expect(await lerPapel.executar(x.credencial, undefined)).toEqual({ ok: true, dados: 'gestor' });

    const antes = Date.now();
    await encerrarSessao(x.token);
    const revogada = (await sessaoDoToken(x.token)).revogada_em;
    expect(revogada).not.toBeNull();
    expect(revogada!.getTime()).toBeGreaterThanOrEqual(antes - 1000);

    await expect(resolverTenant(x.credencial)).rejects.toBeInstanceOf(NaoAutenticado);
    expect(await lerPapel.executar(x.credencial, undefined)).toEqual(NAO_AUTENTICADO);
    cookie.valor = x.token;
    await expect(exigirContexto()).rejects.toBeInstanceOf(NaoAutenticado);

    expect(await lerPapel.executar(y.credencial, undefined)).toEqual({ ok: true, dados: 'gestor' });
    cookie.valor = y.token;
    expect((await exigirContexto()).usuarioId).toBe(a.gestor.usuarioId);
  });

  it('CA-4: logout idempotente: repetido, sem token ou com token desconhecido não lança nem altera', async () => {
    const x = await entrarDeVerdade(a.gestor.email);
    const agora = new Date('2030-01-01T00:00:00.000Z');
    await encerrarSessao(x.token, agora);
    await encerrarSessao(x.token, new Date('2031-01-01T00:00:00.000Z'));
    expect((await sessaoDoToken(x.token)).revogada_em).toEqual(agora);
    await expect(encerrarSessao(null)).resolves.toBeUndefined();
    await expect(encerrarSessao(undefined)).resolves.toBeUndefined();
    await expect(encerrarSessao('')).resolves.toBeUndefined();
    await expect(encerrarSessao('token-desconhecido')).resolves.toBeUndefined();
  });
});

describe('CA-5: sessão antiga do profissional desativado e revogação por usuário', () => {
  it('CA-5: sessão criada antes da desativação deixa de resolver (401) sem revogação', async () => {
    const s = await criarSalaoCompleto();
    const { credencial, token } = await entrarDeVerdade(s.profissional.email);
    expect((await resolverTenant(credencial)).papel).toBe('profissional');
    await c.query('UPDATE profissional SET ativo = false WHERE id = $1', [s.profissional.profissionalId]);
    await expect(resolverTenant(credencial)).rejects.toBeInstanceOf(NaoAutenticado);
    expect(await acaoValida.executar(credencial, undefined)).toEqual(NAO_AUTENTICADO);
    expect((await sessaoDoToken(token)).revogada_em).toBeNull();
  });

  it('CA-5: revogarSessoesDoUsuario preenche revogada_em de todas as sessões e devolve a contagem', async () => {
    const s = await criarSalaoCompleto();
    const tokens = [
      (await entrarDeVerdade(s.profissional.email)).token,
      (await entrarDeVerdade(s.profissional.email)).token,
      (await entrarDeVerdade(s.profissional.email)).token,
    ];
    await encerrarSessao(tokens[0]);
    const outro = await entrarDeVerdade(s.gestor.email);

    const agora = new Date();
    expect(await revogarSessoesDoUsuario(s.profissional.usuarioId, agora)).toBe(2);
    for (const t of tokens) {
      expect((await sessaoDoToken(t)).revogada_em).not.toBeNull();
      await expect(resolverTenant({ token: t })).rejects.toBeInstanceOf(NaoAutenticado);
    }
    expect((await sessaoDoToken(tokens[1])).revogada_em).toEqual(agora);
    expect(await revogarSessoesDoUsuario(s.profissional.usuarioId)).toBe(0);
    // Outro usuário não é afetado; as linhas não são apagadas.
    expect((await resolverTenant(outro.credencial)).papel).toBe('gestor');
    const linhas = await c.query('SELECT 1 FROM sessao WHERE usuario_id = $1', [s.profissional.usuarioId]);
    expect(linhas.rowCount).toBe(3);
  });
});

describe('CA-17: isolamento entre salões com login real', () => {
  const ler = defineAcao({ papeis: ['gestor'], capacidade: 'leitura' }, async (ctx: TenantContext, id: string) =>
    (await repos().profissionais.buscarPorId(ctx, id)).nome,
  );
  const renomear = defineAcao(
    { papeis: ['gestor'], capacidade: 'configurar' },
    async (ctx: TenantContext, input: { id: string; nome: string }) =>
      (await repos().profissionais.renomear(ctx, input.id, input.nome)).nome,
  );

  it('CA-17: o token de A resolve o salão de A; leitura e alteração por ID de B → 404 e B intacto', async () => {
    const { credencial } = await entrarDeVerdade(a.gestor.email);
    expect((await resolverTenant(credencial)).salaoId).toBe(a.salaoId);

    const alvoB = b.profissional.profissionalId;
    const nomeB = await nomeDoProfissional(alvoB);
    expect(await ler.executar(credencial, alvoB)).toEqual(NAO_ENCONTRADO);
    expect(await renomear.executar(credencial, { id: alvoB, nome: 'Alterado por A' })).toEqual(NAO_ENCONTRADO);
    expect(await nomeDoProfissional(alvoB)).toBe(nomeB);

    // Controle: o mesmo recurso do próprio salão funciona.
    expect(await ler.executar(credencial, a.profissional.profissionalId)).toEqual({
      ok: true,
      dados: await nomeDoProfissional(a.profissional.profissionalId),
    });
  });
});
