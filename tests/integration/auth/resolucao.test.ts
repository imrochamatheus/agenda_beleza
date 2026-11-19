import { randomBytes } from 'node:crypto';

import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { obterPrisma } from '@/server/repos/db';
import { decrementarJanela, incrementarJanela } from '@/server/repos/rate-limit';
import { buscarSessaoValida, criarSessao, renovarSessao } from '@/server/repos/sessao';
import { buscarIdentidadeDoPainel, buscarUsuarioParaLogin } from '@/server/repos/usuario';
import { contextoDeSistema, criarTenantContext } from '@/server/tenant/context';
import type { TenantContext } from '@/server/tenant/context';
import { defineAcao } from '@/server/tenant/define-acao';
import { NaoAutenticado, NaoEncontrado } from '@/server/tenant/erros';
import { hashDoToken, resolverAdmin, resolverTenant } from '@/server/tenant/sessao';

import { criarSuperAdmin } from '../../support/auth';
import { criarDoisSaloes, criarSalaoCompleto, hashDaSenhaDeTeste } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { conectar, emailNovo } from '../../support/sql';

// D-010 T-2: CA-14 (validade e renovação com relógio injetado), RN-14 na resolução (CA-5),
// repositórios de usuário e de rate limit (CA-12, incremento concorrente). PostgreSQL real.

const HORA = 60 * 60 * 1000;
const DIA = 24 * HORA;

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

/** Sessão criada pelo repositório de produção no instante T0 (relógio injetado). */
async function sessaoEm(usuarioId: string, t0: Date): Promise<{ token: string; tokenHash: string }> {
  const token = randomBytes(32).toString('base64url');
  const tokenHash = hashDoToken(token);
  await criarSessao({ usuarioId, tokenHash, agora: t0, expiraEm: new Date(t0.getTime() + 7 * DIA) });
  return { token, tokenHash };
}

async function linha(tokenHash: string) {
  const r = await c.query<{ expira_em: Date; ultimo_uso_em: Date | null; criado_em: Date }>(
    'SELECT expira_em, ultimo_uso_em, criado_em FROM sessao WHERE token_hash = $1',
    [tokenHash],
  );
  return r.rows[0];
}

describe('CA-14: validade de 7 d renovada no uso, teto de 30 d', () => {
  it('CA-14: criarSessao grava criado_em e ultimo_uso_em com o relógio injetado', async () => {
    const t0 = new Date('2026-01-10T10:00:00.000Z');
    const { tokenHash } = await sessaoEm(a.gestor.usuarioId, t0);
    expect(await linha(tokenHash)).toEqual({ criado_em: t0, ultimo_uso_em: t0, expira_em: new Date(t0.getTime() + 7 * DIA) });
  });

  it('CA-14: uso em T0 + 6 d → expira_em = T0 + 13 d e ultimo_uso_em gravado; uso 30 min depois não grava', async () => {
    const t0 = new Date('2026-02-01T08:00:00.000Z');
    const { token, tokenHash } = await sessaoEm(a.gestor.usuarioId, t0);
    const t6 = new Date(t0.getTime() + 6 * DIA);
    await resolverTenant({ token }, t6);
    expect(await linha(tokenHash)).toMatchObject({ ultimo_uso_em: t6, expira_em: new Date(t0.getTime() + 13 * DIA) });

    await resolverTenant({ token }, new Date(t6.getTime() + 30 * 60 * 1000));
    await resolverTenant({ token }, new Date(t6.getTime() + HORA));
    expect(await linha(tokenHash)).toMatchObject({ ultimo_uso_em: t6, expira_em: new Date(t0.getTime() + 13 * DIA) });

    const depois = new Date(t6.getTime() + HORA + 1);
    await resolverTenant({ token }, depois);
    expect((await linha(tokenHash)).ultimo_uso_em).toEqual(depois);
  });

  it('CA-14: sem uso por 7 d → NaoAutenticado (no instante exato de expira_em já expirou)', async () => {
    const t0 = new Date('2026-03-01T00:00:00.000Z');
    const { token } = await sessaoEm(a.gestor.usuarioId, t0);
    await expect(resolverTenant({ token }, new Date(t0.getTime() + 7 * DIA))).rejects.toBeInstanceOf(NaoAutenticado);
    await expect(resolverTenant({ token }, new Date(t0.getTime() + 7 * DIA - 1))).resolves.toMatchObject({
      papel: 'gestor',
    });
  });

  it('CA-14: com uso contínuo, em T0 + 30 d → NaoAutenticado (teto absoluto)', async () => {
    const t0 = new Date('2026-04-01T12:00:00.000Z');
    const { token, tokenHash } = await sessaoEm(a.gestor.usuarioId, t0);
    for (const dias of [6, 12, 18, 24, 29]) {
      await resolverTenant({ token }, new Date(t0.getTime() + dias * DIA));
    }
    expect((await linha(tokenHash)).expira_em).toEqual(new Date(t0.getTime() + 30 * DIA));
    await expect(resolverTenant({ token }, new Date(t0.getTime() + 30 * DIA - 1))).resolves.toBeDefined();
    await expect(resolverTenant({ token }, new Date(t0.getTime() + 30 * DIA))).rejects.toBeInstanceOf(NaoAutenticado);
  });

  it('CA-14: renovações concorrentes geram no máximo uma escrita', async () => {
    const t0 = new Date('2026-05-01T12:00:00.000Z');
    const { tokenHash } = await sessaoEm(a.gestor.usuarioId, t0);
    const sessao = await buscarSessaoValida(tokenHash, t0);
    const agora = new Date(t0.getTime() + 2 * DIA);
    const resultados = await Promise.all(
      Array.from({ length: 10 }, () =>
        renovarSessao({
          sessaoId: sessao!.sessaoId,
          agora,
          expiraEm: new Date(agora.getTime() + 7 * DIA),
          usoAnteriorA: new Date(agora.getTime() - HORA),
        }),
      ),
    );
    expect(resultados.filter(Boolean)).toHaveLength(1);
    expect((await linha(tokenHash)).ultimo_uso_em).toEqual(agora);
  });

  it('CA-14: sessão sem ultimo_uso_em (legado) é renovada no primeiro uso; resolverAdmin também renova (DD-4)', async () => {
    const admin = await criarSuperAdmin({ totpVerificado: true });
    const hash = hashDoToken(admin.credencial!.token);
    expect((await linha(hash)).ultimo_uso_em).toBeNull();
    const agora = new Date();
    await resolverAdmin(admin.credencial, agora);
    expect((await linha(hash)).ultimo_uso_em).toEqual(agora);
  });

  it('CA-14: sessão revogada ou expirada não é renovada', async () => {
    const t0 = new Date('2026-06-01T12:00:00.000Z');
    const { tokenHash } = await sessaoEm(a.gestor.usuarioId, t0);
    const s = await buscarSessaoValida(tokenHash, t0);
    await c.query('UPDATE sessao SET revogada_em = $2 WHERE token_hash = $1', [tokenHash, t0]);
    const renovou = await renovarSessao({
      sessaoId: s!.sessaoId,
      agora: new Date(t0.getTime() + DIA),
      expiraEm: new Date(t0.getTime() + 8 * DIA),
      usoAnteriorA: new Date(t0.getTime() + DIA - HORA),
    });
    expect(renovou).toBe(false);
    expect((await linha(tokenHash)).ultimo_uso_em).toEqual(t0);
  });
});

describe('CA-5 / RN-14: profissional inativo ou sem perfil não resolve contexto', () => {
  const acao = defineAcao({ papeis: ['gestor', 'profissional'], capacidade: 'leitura' }, async (ctx: TenantContext) => ctx.papel);

  it('RN-14: sessão do profissional ativo resolve; depois de desativado → 401 sem revogação', async () => {
    const s = await criarSalaoCompleto();
    const agora = new Date();
    const { token, tokenHash } = await sessaoEm(s.profissional.usuarioId, agora);
    expect(await resolverTenant({ token })).toMatchObject({ papel: 'profissional', profissionalId: s.profissional.profissionalId });

    await c.query('UPDATE profissional SET ativo = false WHERE id = $1', [s.profissional.profissionalId]);
    await expect(resolverTenant({ token })).rejects.toBeInstanceOf(NaoAutenticado);
    expect(await acao.executar({ token }, undefined)).toEqual({ ok: false, erro: 'nao_autenticado', status: 401 });
    const r = await c.query('SELECT revogada_em FROM sessao WHERE token_hash = $1', [tokenHash]);
    expect(r.rows).toEqual([{ revogada_em: null }]);

    // Reativado, a sessão não revogada volta a resolver (a revogação explícita é da E2.2).
    await c.query('UPDATE profissional SET ativo = true WHERE id = $1', [s.profissional.profissionalId]);
    expect(await acao.executar({ token }, undefined)).toEqual({ ok: true, dados: 'profissional' });
  });

  it('RN-14: usuário profissional sem perfil vinculado → 401 (falha fechada)', async () => {
    const u = await obterPrisma().usuario.create({
      data: {
        salaoId: a.salaoId,
        papel: 'profissional',
        email: emailNovo(),
        nome: 'Sem perfil',
        senhaHash: await hashDaSenhaDeTeste(),
        emailConfirmadoEm: new Date(),
      },
      select: { id: true },
    });
    const { token } = await sessaoEm(u.id, new Date());
    await expect(resolverTenant({ token })).rejects.toBeInstanceOf(NaoAutenticado);
  });

  it('RN-14: gestor com perfil de profissional inativo continua resolvendo como gestor', async () => {
    const s = await criarSalaoCompleto();
    await c.query('UPDATE profissional SET ativo = false WHERE id = $1', [s.gestor.profissionalId]);
    const { token } = await sessaoEm(s.gestor.usuarioId, new Date());
    expect({ ...(await resolverTenant({ token })) }).toEqual({
      tipo: 'tenant',
      usuarioId: s.gestor.usuarioId,
      papel: 'gestor',
      salaoId: s.salaoId,
      profissionalId: s.gestor.profissionalId,
    });
  });
});

describe('repos/usuario.ts', () => {
  it('buscarUsuarioParaLogin: dados de login do gestor, do profissional e do super admin; inexistente → null', async () => {
    const hash = await hashDaSenhaDeTeste();
    expect(await buscarUsuarioParaLogin(a.gestor.email)).toEqual({
      id: a.gestor.usuarioId,
      papel: 'gestor',
      senhaHash: hash,
      emailConfirmado: true,
      profissionalAtivo: true,
    });
    expect(await buscarUsuarioParaLogin(a.profissional.email)).toMatchObject({
      id: a.profissional.usuarioId,
      papel: 'profissional',
      profissionalAtivo: true,
    });
    const semPerfil = await criarSalaoCompleto({ gestor: { comPerfil: false, emailConfirmado: false } });
    expect(await buscarUsuarioParaLogin(semPerfil.gestor.email)).toMatchObject({
      emailConfirmado: false,
      profissionalAtivo: null,
    });
    expect(await buscarUsuarioParaLogin('ninguem@exemplo.invalid')).toBeNull();
  });

  it('buscarIdentidadeDoPainel: nomes do usuário e do salão do contexto', async () => {
    const { token } = await sessaoEm(a.gestor.usuarioId, new Date());
    const ctx = await resolverTenant({ token });
    expect(await buscarIdentidadeDoPainel(ctx)).toEqual({ nomeUsuario: a.gestor.nome, nomeSalao: a.nome });
  });

  it('buscarIdentidadeDoPainel: usuário de A com salaoId de B (contexto forjado) → NaoEncontrado; sistema → Error', async () => {
    const forjado = criarTenantContext({
      usuarioId: a.gestor.usuarioId,
      papel: 'gestor',
      salaoId: b.salaoId,
      profissionalId: null,
    });
    await expect(buscarIdentidadeDoPainel(forjado)).rejects.toBeInstanceOf(NaoEncontrado);
    const sistema = contextoDeSistema(a.salaoId, 'teste') as unknown as TenantContext;
    await expect(buscarIdentidadeDoPainel(sistema)).rejects.toThrow('identidade do painel exige TenantContext');
  });
});

describe('CA-12: repos/rate-limit.ts', () => {
  it('CA-12: 20 incrementos concorrentes → contador exato e cada valor devolvido uma vez', async () => {
    const chave = `teste:${randomBytes(8).toString('hex')}`;
    const janela = new Date('2026-07-01T10:15:00.000Z');
    const valores = await Promise.all(Array.from({ length: 20 }, () => incrementarJanela(chave, janela)));
    expect([...valores].sort((x, y) => x - y)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    const r = await c.query('SELECT contador FROM rate_limit_janela WHERE chave = $1 AND janela_inicio = $2', [chave, janela]);
    expect(r.rows).toEqual([{ contador: 20 }]);
  });

  it('CA-12: janelas distintas são independentes; decremento não fica negativo; janela inexistente não lança', async () => {
    const chave = `teste:${randomBytes(8).toString('hex')}`;
    const j1 = new Date('2026-07-01T10:00:00.000Z');
    const j2 = new Date('2026-07-01T10:15:00.000Z');
    expect(await incrementarJanela(chave, j1)).toBe(1);
    expect(await incrementarJanela(chave, j2)).toBe(1);
    expect(await incrementarJanela(chave, j1)).toBe(2);
    await decrementarJanela(chave, j1);
    await decrementarJanela(chave, j2);
    await decrementarJanela(chave, j2);
    await decrementarJanela(`${chave}:outra`, j1);
    const r = await c.query<{ janela_inicio: Date; contador: number }>(
      'SELECT janela_inicio, contador FROM rate_limit_janela WHERE chave = $1 ORDER BY janela_inicio',
      [chave],
    );
    expect(r.rows).toEqual([
      { janela_inicio: j1, contador: 1 },
      { janela_inicio: j2, contador: 0 },
    ]);
    expect(await incrementarJanela(chave, j2)).toBe(1);
  });
});
