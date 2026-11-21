import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { exigirAcessoAoAdmin } from '@/server/auth/admin/pagina';
import { entrarAdmin } from '@/server/auth/admin/login-admin';
import { TETO_ADMIN_MS } from '@/server/auth/admin/validade-admin';
import { AcessoNegado, NaoAutenticado } from '@/server/tenant/erros';
import { resolverAdmin, resolverTenant } from '@/server/tenant/sessao';

import { criarSessao } from '../../../support/auth';
import { criarSalaoCompleto } from '../../../support/factories';
import type { SalaoCompleto } from '../../../support/factories';
import { SENHA_DE_TESTE } from '../../../support/factories';
import { conectar } from '../../../support/sql';

import { CHAVE, abrirSessaoAdmin, criarAdmin } from './apoio';

// D-034: política da sessão admin (CA-9), isolamento (CA-14) e guarda de página (CA-4, RN-10).

class Redirecionado extends Error {
  constructor(readonly destino: string) {
    super(`NEXT_REDIRECT ${destino}`);
  }
}
const jar = vi.hoisted(() => ({ admin: undefined as string | undefined, salao: undefined as string | undefined }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (nome: string) => {
      const valor = nome === 'ab_admin' ? jar.admin : nome === 'ab_sessao' ? jar.salao : undefined;
      return valor === undefined ? undefined : { name: nome, value: valor };
    },
  }),
}));
vi.mock('next/navigation', () => ({
  redirect: (destino: string) => {
    throw new Redirecionado(destino);
  },
}));

const T0 = new Date('2026-11-21T12:00:00.000Z');
const apos = (d: Date, min: number) => new Date(d.getTime() + min * 60_000);

let c: pg.Client;
let s: SalaoCompleto;
beforeAll(async () => {
  c = await conectar();
  s = await criarSalaoCompleto();
});
afterAll(async () => {
  await c.end();
});
beforeEach(() => {
  jar.admin = undefined;
  jar.salao = undefined;
});

async function linhaDaSessao(token: string) {
  const { createHash } = await import('node:crypto');
  const r = await c.query<{ expira_em: Date; ultimo_uso_em: Date; criado_em: Date }>(
    'SELECT expira_em, ultimo_uso_em, criado_em FROM sessao WHERE token_hash = $1',
    [createHash('sha256').update(token).digest('hex')],
  );
  return r.rows[0];
}

describe('CA-9: validade da sessão admin', () => {
  it('renova por 30 min (nunca 7 d), no máximo uma escrita por minuto', async () => {
    const { admin, token } = await abrirSessaoAdmin(T0);
    expect((await linhaDaSessao(token)).expira_em).toEqual(apos(T0, 30));
    expect(admin.id).toBeTruthy();
    // Dentro do minuto: nada escrito.
    await resolverAdmin({ token }, new Date(T0.getTime() + 30_000));
    expect((await linhaDaSessao(token)).ultimo_uso_em).toEqual(T0);
    // Depois de 2 min: renova para uso + 30 min.
    await resolverAdmin({ token }, apos(T0, 2));
    const l = await linhaDaSessao(token);
    expect(l.ultimo_uso_em).toEqual(apos(T0, 2));
    expect(l.expira_em).toEqual(apos(T0, 32));
  });

  it('expira após 30 min de inatividade', async () => {
    const { token } = await abrirSessaoAdmin(T0);
    await expect(resolverAdmin({ token }, apos(T0, 30))).rejects.toBeInstanceOf(NaoAutenticado);
    const outra = await abrirSessaoAdmin(T0);
    await expect(resolverAdmin({ token: outra.token }, apos(T0, 29))).resolves.toBeTruthy();
  });

  it('teto absoluto de 8 h, mesmo com uso contínuo', async () => {
    const { token } = await abrirSessaoAdmin(T0);
    let t = T0;
    for (let i = 0; i < 19; i += 1) {
      t = apos(t, 25);
      await resolverAdmin({ token }, t);
      expect((await linhaDaSessao(token)).expira_em.getTime()).toBeLessThanOrEqual(T0.getTime() + TETO_ADMIN_MS);
    }
    // t = T0 + 7 h 55 min; o próximo uso renova só até o teto.
    await resolverAdmin({ token }, apos(T0, 7 * 60 + 59));
    expect((await linhaDaSessao(token)).expira_em).toEqual(new Date(T0.getTime() + TETO_ADMIN_MS));
    await expect(resolverAdmin({ token }, apos(T0, 8 * 60))).rejects.toBeInstanceOf(NaoAutenticado);
  });
});

describe('CA-14: isolamento entre sessão admin e sessão de salão', () => {
  it('resolverTenant com sessão admin → AcessoNegado, sem renovar nada', async () => {
    const { token } = await abrirSessaoAdmin(T0);
    const antes = await linhaDaSessao(token);
    await expect(resolverTenant({ token }, apos(T0, 5))).rejects.toBeInstanceOf(AcessoNegado);
    expect(await linhaDaSessao(token)).toEqual(antes);
  });

  it('pré-sessão não é renovada e não resolve como admin', async () => {
    const admin = await criarAdmin('ativo');
    const e1 = await entrarAdmin({ email: admin.email, senha: SENHA_DE_TESTE }, { agora: T0, chave: CHAVE, log: () => {} });
    if (!e1.ok) throw new Error('etapa 1');
    const antes = await linhaDaSessao(e1.token);
    await expect(resolverAdmin({ token: e1.token }, apos(T0, 5))).rejects.toBeInstanceOf(AcessoNegado);
    expect(await linhaDaSessao(e1.token)).toEqual(antes);
  });

  it('sessão de gestor e de profissional em resolverAdmin → AcessoNegado; a do salão continua com a renovação 7/30 d', async () => {
    const g = await criarSessao(s.gestor.usuarioId, { totpVerificadoEm: new Date() });
    await expect(resolverAdmin(g.credencial, new Date())).rejects.toBeInstanceOf(AcessoNegado);
    const p = await criarSessao(s.profissional.usuarioId);
    await expect(resolverAdmin(p.credencial, new Date())).rejects.toBeInstanceOf(AcessoNegado);
    // Gestor: renova com a política do salão (7 d), não a do admin.
    const agora = new Date();
    await c.query(`UPDATE sessao SET ultimo_uso_em = $2 WHERE id = $1`, [g.sessaoId, apos(agora, -120)]);
    await resolverTenant(g.credencial, agora);
    const r = await c.query<{ expira_em: Date }>('SELECT expira_em FROM sessao WHERE id = $1', [g.sessaoId]);
    expect(r.rows[0].expira_em.getTime()).toBe(agora.getTime() + 7 * 24 * 3600_000);
  });
});

describe('CA-4 / RN-10: exigirAcessoAoAdmin', () => {
  const destino = async () => ((await exigirAcessoAoAdmin(T0).catch((e: unknown) => e)) as Redirecionado).destino;

  it('sem nenhum cookie → redirect para /admin/entrar', async () => {
    expect(await destino()).toBe('/admin/entrar');
  });

  it('gestor e profissional logados no salão → negado (403, sem redirecionar)', async () => {
    jar.salao = (await criarSessao(s.gestor.usuarioId)).token;
    expect(await exigirAcessoAoAdmin()).toEqual({ tipo: 'negado' });
    jar.salao = (await criarSessao(s.profissional.usuarioId)).token;
    expect(await exigirAcessoAoAdmin()).toEqual({ tipo: 'negado' });
  });

  it('cookie de salão inválido ou expirado → redirect (401)', async () => {
    jar.salao = 'token-qualquer';
    expect(await destino()).toBe('/admin/entrar');
    jar.salao = (await criarSessao(s.gestor.usuarioId, { expiraEm: new Date(0) })).token;
    expect(await destino()).toBe('/admin/entrar');
  });

  it('token de sessão de salão no ab_admin → negado', async () => {
    jar.admin = (await criarSessao(s.gestor.usuarioId)).token;
    expect(await exigirAcessoAoAdmin()).toEqual({ tipo: 'negado' });
  });

  it('pré-sessão (TOTP pendente) e sessão admin expirada → redirect; nunca conteúdo', async () => {
    const admin = await criarAdmin('ativo');
    const e1 = await entrarAdmin({ email: admin.email, senha: SENHA_DE_TESTE }, { agora: T0, chave: CHAVE, log: () => {} });
    if (!e1.ok) throw new Error('etapa 1');
    jar.admin = e1.token;
    expect(await destino()).toBe('/admin/entrar');
    const { token } = await abrirSessaoAdmin(T0);
    jar.admin = token;
    expect(await exigirAcessoAoAdmin(apos(T0, 31)).catch((e: unknown) => (e as Redirecionado).destino)).toBe('/admin/entrar');
  });

  it('sessão admin válida → permitido com o AdminContext; o ab_admin vale mais que o ab_sessao', async () => {
    const { admin, token } = await abrirSessaoAdmin(T0);
    jar.admin = token;
    jar.salao = (await criarSessao(s.gestor.usuarioId)).token;
    const r = await exigirAcessoAoAdmin(apos(T0, 1));
    expect(r.tipo === 'permitido' && r.ctx).toMatchObject({ tipo: 'admin', usuarioId: admin.id });
  });
});
