import { randomBytes } from 'node:crypto';

import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  buscarAlvoRecuperacao,
  buscarTokenRecuperacao,
  emitirTokenRecuperacao,
  redefinirSenhaComToken,
} from '@/server/repos/token-recuperacao';
import type { Elegibilidade } from '@/server/repos/token-recuperacao';
import { hashDoToken } from '@/server/tenant/sessao';

import { criarSessao, criarSuperAdmin } from '../../support/auth';
import { criarSalaoCompleto } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { conectar, emailNovo } from '../../support/sql';

// D-012 T-1: repositório pré-contexto da recuperação de senha contra PostgreSQL real. Todos os
// resultados de emitirTokenRecuperacao e redefinirSenhaComToken, invalidações por tipo, COALESCE da
// confirmação, revogação só do dono, DELETE só da janela certa, desfazer em erro e DTOs sem hash.
// CA-1, CA-3, CA-8, CA-11 (sequencial), CA-13 e CA-15 no nível do repositório.

const HORA_MS = 60 * 60 * 1000;
const T0 = new Date('2026-11-19T12:00:00.000Z');
const todos: Elegibilidade = () => true;
const nenhum: Elegibilidade = () => false;

let c: pg.Client;
let s: SalaoCompleto;

beforeAll(async () => {
  c = await conectar();
  s = await criarSalaoCompleto();
});
afterAll(async () => {
  await c.end();
});

const novoHash = () => hashDoToken(randomBytes(32).toString('base64url'));

async function inserirToken(
  usuarioId: string,
  o: { tipo?: 'recuperacao_senha' | 'confirmacao_email'; expiraEm?: Date; usadoEm?: Date | null; invalidadoEm?: Date | null } = {},
): Promise<string> {
  const h = novoHash();
  await c.query(
    'INSERT INTO token (usuario_id, tipo, token_hash, expira_em, usado_em, invalidado_em, criado_em) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [usuarioId, o.tipo ?? 'recuperacao_senha', h, o.expiraEm ?? new Date(T0.getTime() + HORA_MS), o.usadoEm ?? null, o.invalidadoEm ?? null, T0],
  );
  return h;
}

async function token(h: string) {
  const r = await c.query<{ tipo: string; usado_em: Date | null; invalidado_em: Date | null; expira_em: Date; criado_em: Date }>(
    'SELECT tipo::text AS tipo, usado_em, invalidado_em, expira_em, criado_em FROM token WHERE token_hash = $1',
    [h],
  );
  return r.rows[0];
}

async function usuario(id: string) {
  const r = await c.query<{ senha_hash: string; atualizado_em: Date; email_confirmado_em: Date | null }>(
    'SELECT senha_hash, atualizado_em, email_confirmado_em FROM usuario WHERE id = $1',
    [id],
  );
  return r.rows[0];
}

async function sessoesAtivas(usuarioId: string): Promise<number> {
  const r = await c.query<{ n: number }>('SELECT count(*)::int AS n FROM sessao WHERE usuario_id = $1 AND revogada_em IS NULL', [usuarioId]);
  return r.rows[0].n;
}

async function janela(chave: string, inicio: Date): Promise<number | null> {
  const r = await c.query<{ contador: number }>('SELECT contador FROM rate_limit_janela WHERE chave = $1 AND janela_inicio = $2', [chave, inicio]);
  return r.rows[0]?.contador ?? null;
}

function redefinir(tokenHash: string, o: Partial<Parameters<typeof redefinirSenhaComToken>[0]> = {}) {
  return redefinirSenhaComToken({
    tokenHash,
    senhaHash: '$argon2id$novo',
    agora: new Date(T0.getTime() + 60_000),
    chaveLogin: `login:${randomBytes(8).toString('hex')}`,
    janelaLogin: T0,
    elegivel: todos,
    ...o,
  });
}

describe('buscarAlvoRecuperacao', () => {
  it('gestor com perfil, profissional ativo e super admin; e-mail inexistente → null; DTO sem hash', async () => {
    const g = await buscarAlvoRecuperacao(s.gestor.email);
    expect(g).toEqual({
      usuarioId: s.gestor.usuarioId,
      email: s.gestor.email,
      nome: s.gestor.nome,
      papel: 'gestor',
      profissionalAtivo: true,
    });
    expect(await buscarAlvoRecuperacao(s.profissional.email)).toMatchObject({ papel: 'profissional', profissionalAtivo: true });
    const admin = await criarSuperAdmin();
    expect(await buscarAlvoRecuperacao(admin.email)).toMatchObject({ papel: 'super_admin', profissionalAtivo: null });
    expect(await buscarAlvoRecuperacao(emailNovo())).toBeNull();
    expect(JSON.stringify(g)).not.toMatch(/hash|argon2/i);
  });

  it('gestor sem perfil de profissional → profissionalAtivo null; profissional inativo → false', async () => {
    const x = await criarSalaoCompleto({ gestor: { comPerfil: false }, profissional: { ativo: false } });
    expect(await buscarAlvoRecuperacao(x.gestor.email)).toMatchObject({ papel: 'gestor', profissionalAtivo: null });
    expect(await buscarAlvoRecuperacao(x.profissional.email)).toMatchObject({ papel: 'profissional', profissionalAtivo: false });
  });
});

describe('buscarTokenRecuperacao (só leitura)', () => {
  it('devolve dono e estado do token de recuperação; confirmação ou desconhecido → null; nada é gravado', async () => {
    const usado = new Date(T0.getTime() + 1000);
    const h = await inserirToken(s.profissional.usuarioId, { usadoEm: usado });
    const antes = await token(h);
    const t = await buscarTokenRecuperacao(h);
    expect(t).toEqual({
      usuarioId: s.profissional.usuarioId,
      email: s.profissional.email,
      nome: s.profissional.nome,
      papel: 'profissional',
      profissionalAtivo: true,
      usadoEm: usado,
      invalidadoEm: null,
      expiraEm: new Date(T0.getTime() + HORA_MS),
    });
    expect(JSON.stringify(t)).not.toContain(h);
    expect(await token(h)).toEqual(antes);

    const conf = await inserirToken(s.gestor.usuarioId, { tipo: 'confirmacao_email' });
    expect(await buscarTokenRecuperacao(conf)).toBeNull();
    expect(await buscarTokenRecuperacao(novoHash())).toBeNull();
  });
});

describe('emitirTokenRecuperacao (RN-9, RN-12)', () => {
  it('CA-1/CA-4c: emite; invalida os pendentes de recuperação (inclusive vencidos); usados e de confirmação intactos', async () => {
    const x = await criarSalaoCompleto({ gestor: { emailConfirmado: false } });
    const u = x.gestor.usuarioId;
    const pendente = await inserirToken(u);
    const vencido = await inserirToken(u, { expiraEm: new Date(T0.getTime() - 1) });
    const usado = await inserirToken(u, { usadoEm: T0 });
    const confirmacao = await inserirToken(u, { tipo: 'confirmacao_email' });
    const agora = new Date(T0.getTime() + 60_000);
    const novo = novoHash();
    const expiraEm = new Date(agora.getTime() + HORA_MS);

    expect(await emitirTokenRecuperacao({ usuarioId: u, tokenHash: novo, expiraEm, agora, elegivel: todos })).toBe('emitido');
    expect(await token(novo)).toEqual({ tipo: 'recuperacao_senha', usado_em: null, invalidado_em: null, expira_em: expiraEm, criado_em: agora });
    expect((await token(pendente)).invalidado_em).toEqual(agora);
    expect((await token(vencido)).invalidado_em).toEqual(agora);
    expect(await token(usado)).toMatchObject({ usado_em: T0, invalidado_em: null });
    expect(await token(confirmacao)).toMatchObject({ usado_em: null, invalidado_em: null });
  });

  it('não elegível ou usuário ausente → nao_aplicavel, nada gravado', async () => {
    const x = await criarSalaoCompleto();
    const pendente = await inserirToken(x.profissional.usuarioId);
    const h = novoHash();
    const base = { tokenHash: h, expiraEm: new Date(T0.getTime() + HORA_MS), agora: T0 };
    const recebidos: unknown[] = [];
    expect(
      await emitirTokenRecuperacao({
        ...base,
        usuarioId: x.profissional.usuarioId,
        elegivel: (p) => {
          recebidos.push(p);
          return false;
        },
      }),
    ).toBe('nao_aplicavel');
    expect(recebidos).toEqual([{ papel: 'profissional', profissionalAtivo: true }]);
    expect(
      await emitirTokenRecuperacao({ ...base, usuarioId: '00000000-0000-4000-8000-000000000000', elegivel: todos }),
    ).toBe('nao_aplicavel');
    expect(await token(h)).toBeUndefined();
    expect((await token(pendente)).invalidado_em).toBeNull();
  });
});

describe('redefinirSenhaComToken (RN-11, D-3, D-8)', () => {
  it('desconhecido ou de confirmação → invalido; nada muda', async () => {
    const x = await criarSalaoCompleto({ gestor: { emailConfirmado: false } });
    const conf = await inserirToken(x.gestor.usuarioId, { tipo: 'confirmacao_email' });
    const antes = await usuario(x.gestor.usuarioId);
    expect(await redefinir(novoHash())).toEqual({ resultado: 'invalido' });
    expect(await redefinir(conf)).toEqual({ resultado: 'invalido' });
    expect(await usuario(x.gestor.usuarioId)).toEqual(antes);
    expect((await token(conf)).usado_em).toBeNull();
  });

  it('CA-9/CA-14: não elegível → inelegivel; token não consumido, hash e sessões intactos', async () => {
    const x = await criarSalaoCompleto();
    await criarSessao(x.profissional.usuarioId);
    const h = await inserirToken(x.profissional.usuarioId);
    const antes = await usuario(x.profissional.usuarioId);
    expect(await redefinir(h, { elegivel: nenhum })).toEqual({ resultado: 'inelegivel' });
    expect((await token(h)).usado_em).toBeNull();
    expect(await usuario(x.profissional.usuarioId)).toEqual(antes);
    expect(await sessoesAtivas(x.profissional.usuarioId)).toBe(1);
  });

  it('CA-4: usado → ja_utilizado; vencido (no limite exato) e invalidado → expirado_ou_substituido; nada muda', async () => {
    const x = await criarSalaoCompleto();
    const u = x.gestor.usuarioId;
    const agora = new Date(T0.getTime() + HORA_MS);
    const usado = await inserirToken(u, { usadoEm: T0 });
    const noLimite = await inserirToken(u, { expiraEm: agora });
    const invalidado = await inserirToken(u, { invalidadoEm: T0 });
    const antes = await usuario(u);
    expect(await redefinir(usado, { agora })).toEqual({ resultado: 'ja_utilizado' });
    expect(await redefinir(noLimite, { agora })).toEqual({ resultado: 'expirado_ou_substituido' });
    expect(await redefinir(invalidado, { agora })).toEqual({ resultado: 'expirado_ou_substituido' });
    expect(await usuario(u)).toEqual(antes);
    expect((await token(noLimite)).usado_em).toBeNull();
  });

  it('CA-3/CA-8/CA-13/CA-15: redefine; confirma o e-mail; invalida pendentes; revoga só as sessões do dono; apaga só a janela certa', async () => {
    const { a, b } = { a: await criarSalaoCompleto({ gestor: { emailConfirmado: false } }), b: await criarSalaoCompleto() };
    const u = a.gestor.usuarioId;
    await criarSessao(u);
    await criarSessao(u);
    await criarSessao(u, { revogadaEm: T0 });
    await criarSessao(a.profissional.usuarioId);
    await criarSessao(b.gestor.usuarioId);
    const h = await inserirToken(u);
    const outroPendente = await inserirToken(u);
    const confirmacao = await inserirToken(u, { tipo: 'confirmacao_email' });
    const tokenDeB = await inserirToken(b.gestor.usuarioId);
    const chave = `login:${randomBytes(8).toString('hex')}`;
    const outraJanela = new Date(T0.getTime() - 15 * 60_000);
    await c.query('INSERT INTO rate_limit_janela (chave, janela_inicio, contador) VALUES ($1, $2, 10), ($1, $3, 4), ($4, $2, 7)', [
      chave,
      T0,
      outraJanela,
      `${chave}-outra`,
    ]);
    const hashB = (await usuario(b.gestor.usuarioId)).senha_hash;
    const agora = new Date(T0.getTime() + 60_000);

    expect(await redefinir(h, { agora, chaveLogin: chave, janelaLogin: T0 })).toEqual({
      resultado: 'redefinido',
      usuarioId: u,
      sessoesRevogadas: 2,
    });
    expect(await usuario(u)).toEqual({ senha_hash: '$argon2id$novo', atualizado_em: agora, email_confirmado_em: agora });
    expect((await token(h)).usado_em).toEqual(agora);
    expect((await token(outroPendente)).invalidado_em).toEqual(agora);
    expect((await token(confirmacao)).invalidado_em).toEqual(agora);
    expect(await sessoesAtivas(u)).toBe(0);
    const revogadaAntes = await c.query<{ revogada_em: Date }>('SELECT revogada_em FROM sessao WHERE usuario_id = $1 ORDER BY revogada_em', [u]);
    expect(revogadaAntes.rows.map((r) => r.revogada_em)).toEqual([T0, agora, agora]);
    // Isolamento: profissional de A e gestor de B intactos.
    expect(await sessoesAtivas(a.profissional.usuarioId)).toBe(1);
    expect(await sessoesAtivas(b.gestor.usuarioId)).toBe(1);
    expect((await usuario(b.gestor.usuarioId)).senha_hash).toBe(hashB);
    expect(await token(tokenDeB)).toMatchObject({ usado_em: null, invalidado_em: null });
    // D-8: só a janela vigente da chave do login.
    expect(await janela(chave, T0)).toBeNull();
    expect(await janela(chave, outraJanela)).toBe(4);
    expect(await janela(`${chave}-outra`, T0)).toBe(7);
    // Segundo uso do mesmo token.
    expect(await redefinir(h, { agora })).toEqual({ resultado: 'ja_utilizado' });
  });

  it('D-3: quem já confirmou mantém email_confirmado_em', async () => {
    const x = await criarSalaoCompleto();
    const antes = (await usuario(x.profissional.usuarioId)).email_confirmado_em;
    const h = await inserirToken(x.profissional.usuarioId);
    expect((await redefinir(h)).resultado).toBe('redefinido');
    expect((await usuario(x.profissional.usuarioId)).email_confirmado_em).toEqual(antes);
  });

  it('erro do PostgreSQL no meio (NUL no hash) → relança e desfaz tudo: token, hash, sessões e janela', async () => {
    const x = await criarSalaoCompleto();
    const u = x.gestor.usuarioId;
    await criarSessao(u);
    const h = await inserirToken(u);
    const chave = `login:${randomBytes(8).toString('hex')}`;
    await c.query('INSERT INTO rate_limit_janela (chave, janela_inicio, contador) VALUES ($1, $2, 3)', [chave, T0]);
    const antes = await usuario(u);
    await expect(redefinir(h, { senhaHash: 'com\u0000nul', chaveLogin: chave })).rejects.toThrow();
    expect(await usuario(u)).toEqual(antes);
    expect(await token(h)).toMatchObject({ usado_em: null, invalidado_em: null });
    expect(await sessoesAtivas(u)).toBe(1);
    expect(await janela(chave, T0)).toBe(3);
  });
});
