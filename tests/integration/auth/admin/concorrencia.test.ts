import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { cadastrarTotp, entrarAdmin, obterCadastroTotp, verificarTotpAdmin } from '@/server/auth/admin/login-admin';
import { decifrarSegredo } from '@/server/auth/admin/cifra';
import { obterPrisma } from '@/server/repos/db';

import { linhasDeAuditoria } from '../../../support/auditoria';
import { SENHA_DE_TESTE } from '../../../support/factories';
import { conectar } from '../../../support/sql';

import { CHAVE, codigoEm, criarAdmin } from './apoio';

// D-034 CA-7 e cadastro (design §3): anti-replay atômico e "um cadastro vence" sob concorrência real.

const T0 = new Date('2026-11-21T12:00:07.000Z');
const deps = { agora: T0, chave: CHAVE, log: () => {} };
let c: pg.Client;
beforeAll(async () => {
  c = await conectar();
});
afterAll(async () => {
  await c.end();
});

async function preSessao(email: string): Promise<string> {
  const r = await entrarAdmin({ email, senha: SENHA_DE_TESTE }, deps);
  if (!r.ok) throw new Error('etapa 1');
  return r.token;
}

describe('CA-7: replay do mesmo código', () => {
  it('sequencial: o mesmo código aceito 2× → 1 sucesso; passo anterior ao último aceito recusado', async () => {
    const admin = await criarAdmin('ativo');
    const codigo = codigoEm(admin.segredo!, T0);
    const t1 = await preSessao(admin.email);
    expect((await verificarTotpAdmin(t1, codigo, deps)).ok).toBe(true);
    const t2 = await preSessao(admin.email);
    expect(await verificarTotpAdmin(t2, codigo, deps)).toEqual({ ok: false, motivo: 'invalido' });
    // Passo anterior (t-30 s) ao último aceito: recusado também.
    const t3 = await preSessao(admin.email);
    expect(await verificarTotpAdmin(t3, codigoEm(admin.segredo!, T0, -1), deps)).toEqual({ ok: false, motivo: 'invalido' });
    // Passo seguinte: aceito.
    const t4 = await preSessao(admin.email);
    const depois = new Date(T0.getTime() + 30_000);
    expect((await verificarTotpAdmin(t4, codigoEm(admin.segredo!, depois), { ...deps, agora: depois })).ok).toBe(true);
    const falhas = await linhasDeAuditoria(c, `ator_id = $1 AND acao = 'login.falha_totp'`, [admin.id]);
    expect(falhas).toHaveLength(2);
  });

  it.each([2, 10])('%i verificações em paralelo do mesmo código (cada uma com sua pré-sessão) → exatamente 1 sucesso', async (n) => {
    const admin = await criarAdmin('ativo');
    const codigo = codigoEm(admin.segredo!, T0);
    const tokens = await Promise.all(Array.from({ length: n }, () => preSessao(admin.email)));
    const r = await Promise.all(tokens.map((t) => verificarTotpAdmin(t, codigo, deps)));
    expect(r.filter((x) => x.ok)).toHaveLength(1);
    // As perdedoras são recusadas como replay ('invalido') ou já pelo limite de 5 por janela.
    expect(r.filter((x) => !x.ok && (x.motivo === 'invalido' || x.motivo === 'limite'))).toHaveLength(n - 1);
    expect(r.filter((x) => !x.ok && x.motivo === 'invalido').length).toBeGreaterThanOrEqual(1);
    const sessoes = await c.query(`SELECT 1 FROM sessao WHERE usuario_id = $1 AND totp_verificado_em IS NOT NULL`, [admin.id]);
    expect(sessoes.rowCount).toBe(1);
  }, 60_000);

  it('a mesma pré-sessão em paralelo → 1 sucesso, 1 sessão admin', async () => {
    const admin = await criarAdmin('ativo');
    const token = await preSessao(admin.email);
    const codigo = codigoEm(admin.segredo!, T0);
    const r = await Promise.all([1, 2, 3].map(() => verificarTotpAdmin(token, codigo, deps)));
    expect(r.filter((x) => x.ok)).toHaveLength(1);
    const sessoes = await c.query(`SELECT 1 FROM sessao WHERE usuario_id = $1 AND totp_verificado_em IS NOT NULL`, [admin.id]);
    expect(sessoes.rowCount).toBe(1);
  });
});

describe('cadastro do TOTP sob concorrência', () => {
  it('cargas simultâneas da tela geram um único segredo pendente', async () => {
    const admin = await criarAdmin('nenhum');
    const token = await preSessao(admin.email);
    const r = await Promise.all(Array.from({ length: 10 }, () => obterCadastroTotp(token, deps)));
    const chaves = new Set(r.map((x) => (x.ok ? x.chaveAgrupada : 'falha')));
    expect(chaves.size).toBe(1);
    expect(chaves.has('falha')).toBe(false);
    const u = await obterPrisma().usuario.findUniqueOrThrow({ where: { id: admin.id } });
    expect(decifrarSegredo(u.totpSegredoCifrado!, admin.id, CHAVE).length).toBe(32);
  });

  it('dois cadastros com o código certo → um vence, o outro vê o TOTP já ativado', async () => {
    const admin = await criarAdmin('nenhum');
    const t1 = await preSessao(admin.email);
    const t2 = await preSessao(admin.email);
    await obterCadastroTotp(t1, deps);
    const u = await obterPrisma().usuario.findUniqueOrThrow({ where: { id: admin.id } });
    const segredo = decifrarSegredo(u.totpSegredoCifrado!, admin.id, CHAVE);
    const codigo = codigoEm(segredo, T0);
    const r = await Promise.all([cadastrarTotp(t1, codigo, deps), cadastrarTotp(t2, codigo, deps)]);
    expect(r.filter((x) => x.ok)).toHaveLength(1);
    const perdedor = r.find((x) => !x.ok);
    expect(perdedor && !perdedor.ok && ['ativado', 'invalido']).toContain(perdedor && !perdedor.ok ? perdedor.motivo : '');
    const ativado = await c.query(`SELECT count(*)::int AS n FROM auditoria WHERE ator_id = $1 AND acao = 'totp.cadastrar'`, [admin.id]);
    expect(ativado.rows[0].n).toBe(1);
  });
});
