import { randomUUID } from 'node:crypto';

import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { slugBase } from '@/lib/slug';
import {
  LIMITE_REENVIO,
  MENSAGENS_CONFIRMACAO,
  chaveDeReenvio,
  confirmarEmail,
  novoTokenDeConfirmacao,
  reenviarConfirmacao,
} from '@/server/auth/confirmacao-email';
import type { DepsConfirmacao } from '@/server/auth/confirmacao-email';
import { JANELA_MS, inicioDaJanela } from '@/server/auth/login';
import { criarSalaoComGestor } from '@/server/repos/cadastro';
import { hashDoToken } from '@/server/tenant/sessao';

import { criarSalaoCompleto } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { conectar, emailNovo } from '../../support/sql';

// D-011 T-3: serviço de confirmação e reenvio contra PostgreSQL real, com relógio injetado. CA-5
// (limites de 24 h, reenvio pelo token expirado), CA-7 e CA-8 (integração do slug, pelo
// repositório), CA-14, CA-15, CA-16 e CA-19 (logs). O e-mail usa o adaptador do registro
// (simulado, grava em email_log). Literais de slug deste arquivo: `painel`, `salao`.

const HORA_MS = 60 * 60 * 1000;
const APP_URL = 'http://app.teste';
const T0 = new Date('2026-11-19T12:00:00.000Z');
const UNIFORME = { ok: true, mensagem: MENSAGENS_CONFIRMACAO.reenvioUniforme };
const LIMITE = { ok: false, motivo: 'limite', mensagem: MENSAGENS_CONFIRMACAO.reenvioLimite };

let c: pg.Client;
let s: SalaoCompleto;

beforeAll(async () => {
  c = await conectar();
  s = await criarSalaoCompleto();
});
afterAll(async () => {
  await c.end();
});

/** Captura de log e dependências padrão do arquivo. */
function deps(agora: Date, extra: Partial<DepsConfirmacao> = {}) {
  const linhas: string[] = [];
  return { linhas, d: { agora, appUrl: APP_URL, log: (l: string) => linhas.push(l), ...extra } };
}

/** Gestor não confirmado criado pelo repositório, com o token em claro conhecido. */
async function gestor(o: { nomeSalao?: string; agora?: Date } = {}) {
  const agora = o.agora ?? T0;
  const email = emailNovo();
  const t = novoTokenDeConfirmacao(agora);
  const nomeSalao = o.nomeSalao ?? `Salão ${randomUUID().slice(0, 8)}`;
  const r = await criarSalaoComGestor({
    nomeSalao,
    slugBase: slugBase(nomeSalao),
    nomeGestor: 'Gestora Teste',
    email,
    senhaHash: 'x',
    tokenHash: t.tokenHash,
    expiraEm: t.expiraEm,
    agora,
  });
  if (!r.ok) throw new Error('falha ao preparar');
  return { ...r, email, token: t.token, tokenHash: t.tokenHash };
}

async function emails(destinatario: string) {
  const r = await c.query<{ assunto: string; corpo: string }>(
    'SELECT assunto, corpo FROM email_log WHERE destinatario = $1 ORDER BY criado_em, id',
    [destinatario],
  );
  return r.rows;
}

function tokenDoCorpo(corpo: string): string {
  const m = new RegExp(`${APP_URL.replace(/\./g, '\\.')}/confirmar-email\\?token=([A-Za-z0-9_-]{43})`).exec(corpo);
  if (!m) throw new Error('link não encontrado no corpo');
  return m[1];
}

async function tokensDe(usuarioId: string) {
  const r = await c.query<{ token_hash: string; usado_em: Date | null; invalidado_em: Date | null }>(
    `SELECT token_hash, usado_em, invalidado_em FROM token WHERE usuario_id = $1 AND tipo = 'confirmacao_email' ORDER BY criado_em, id`,
    [usuarioId],
  );
  return r.rows;
}

async function confirmadoEm(usuarioId: string): Promise<Date | null> {
  const r = await c.query<{ e: Date | null }>('SELECT email_confirmado_em AS e FROM usuario WHERE id = $1', [usuarioId]);
  return r.rows[0].e;
}

async function totalTokens(): Promise<number> {
  return Number((await c.query<{ n: string }>('SELECT count(*) AS n FROM token')).rows[0].n);
}

async function totalEmails(): Promise<number> {
  return Number((await c.query<{ n: string }>('SELECT count(*) AS n FROM email_log')).rows[0].n);
}

describe('CA-5: validade de 24 h e reenvio pelo link expirado', () => {
  it('CA-5: T+24h−1s confirma (contraprova)', async () => {
    const g = await gestor();
    const agora = new Date(T0.getTime() + 24 * HORA_MS - 1000);
    expect(await confirmarEmail(g.token, deps(agora).d)).toBe('confirmado');
    expect(await confirmadoEm(g.usuarioId)).toEqual(agora);
  });

  it('CA-5: T+24h e T+24h+1s → expirado; o reenvio pelo token grava 1 token novo e 1 e-mail cujo link confirma', async () => {
    const g = await gestor();
    for (const delta of [0, 1000]) {
      const agora = new Date(T0.getTime() + 24 * HORA_MS + delta);
      expect(await confirmarEmail(g.token, deps(agora).d)).toBe('expirado_ou_substituido');
    }
    expect(await confirmadoEm(g.usuarioId)).toBeNull();

    const agora = new Date(T0.getTime() + 25 * HORA_MS);
    expect(await reenviarConfirmacao({ token: g.token }, deps(agora).d)).toEqual(UNIFORME);
    const tokens = await tokensDe(g.usuarioId);
    expect(tokens).toHaveLength(2);
    expect(tokens[0]).toEqual({ token_hash: g.tokenHash, usado_em: null, invalidado_em: agora });
    expect(tokens[1]).toMatchObject({ usado_em: null, invalidado_em: null });
    const recebidos = await emails(g.email);
    expect(recebidos).toHaveLength(1);
    expect(recebidos[0].assunto).toBe('Confirme seu e-mail no Agenda Beleza');
    const novo = tokenDoCorpo(recebidos[0].corpo);
    expect(hashDoToken(novo)).toBe(tokens[1].token_hash);
    expect(await confirmarEmail(novo, deps(new Date(agora.getTime() + 1000)).d)).toBe('confirmado');
    expect(await confirmadoEm(g.usuarioId)).not.toBeNull();
  });
});

describe('CA-7 e CA-8 (integração do slug, pelo repositório)', () => {
  it('CA-7: "Painel" → painel-2 gravado', async () => {
    const g = await gestor({ nomeSalao: 'Painel' });
    expect(g.slug).toBe('painel-2');
    const r = await c.query('SELECT slug, atual FROM salao_slug WHERE salao_id = $1', [g.salaoId]);
    expect(r.rows).toEqual([{ slug: 'painel-2', atual: true }]);
  });

  it('CA-8: "!!!" e "@@" → salao e salao-2', async () => {
    const a = await gestor({ nomeSalao: '!!!' });
    const b = await gestor({ nomeSalao: '@@' });
    expect([a.slug, b.slug]).toEqual(['salao', 'salao-2']);
  });
});

describe('CA-14: confirmarEmail com entradas inválidas', () => {
  it('CA-14: token de outro tipo (recuperacao_senha) → invalido, sem efeito', async () => {
    const g = await gestor();
    const outro = novoTokenDeConfirmacao(T0);
    await c.query(`INSERT INTO token (usuario_id, tipo, token_hash, expira_em) VALUES ($1, 'recuperacao_senha', $2, $3)`, [
      g.usuarioId,
      outro.tokenHash,
      outro.expiraEm,
    ]);
    expect(await confirmarEmail(outro.token, deps(T0).d)).toBe('invalido');
    expect(await confirmadoEm(g.usuarioId)).toBeNull();
    const r = await c.query('SELECT usado_em FROM token WHERE token_hash = $1', [outro.tokenHash]);
    expect(r.rows).toEqual([{ usado_em: null }]);
  });

  it('CA-14: ausente, vazio, 10 KB e desconhecido → invalido, nenhuma linha muda', async () => {
    const g = await gestor();
    const antes = await tokensDe(g.usuarioId);
    for (const t of [undefined, '', 'A'.repeat(10 * 1024), novoTokenDeConfirmacao(T0).token]) {
      expect(await confirmarEmail(t, deps(T0).d)).toBe('invalido');
    }
    expect(await tokensDe(g.usuarioId)).toEqual(antes);
    expect(await confirmadoEm(g.usuarioId)).toBeNull();
  });

  it('D-8: token de confirmação de um profissional → invalido', async () => {
    const t = novoTokenDeConfirmacao(T0);
    await c.query(`INSERT INTO token (usuario_id, tipo, token_hash, expira_em) VALUES ($1, 'confirmacao_email', $2, $3)`, [
      s.profissional.usuarioId,
      t.tokenHash,
      t.expiraEm,
    ]);
    expect(await confirmarEmail(t.token, deps(T0).d)).toBe('invalido');
  });
});

describe('CA-15: reenvio por e-mail', () => {
  it('CA-15: A invalidado, B válido e 1 e-mail; A → expirado, B → confirma; depois, reenvio não grava nada', async () => {
    const g = await gestor();
    const agora = new Date(T0.getTime() + HORA_MS);
    expect(await reenviarConfirmacao({ email: `  ${g.email.toUpperCase()} ` }, deps(agora).d)).toEqual(UNIFORME);
    const [a, b] = await tokensDe(g.usuarioId);
    expect(a).toEqual({ token_hash: g.tokenHash, usado_em: null, invalidado_em: agora });
    expect(b).toMatchObject({ usado_em: null, invalidado_em: null });
    const [m] = await emails(g.email);
    const tokenB = tokenDoCorpo(m.corpo);
    expect(m.corpo).toContain('Gestora Teste');
    expect(m.corpo).toContain('24 horas');

    expect(await confirmarEmail(g.token, deps(agora).d)).toBe('expirado_ou_substituido');
    expect(await confirmarEmail(tokenB, deps(agora).d)).toBe('confirmado');

    const tokens = await totalTokens();
    const enviados = await totalEmails();
    expect(await reenviarConfirmacao({ email: g.email }, deps(agora).d)).toEqual(UNIFORME);
    expect(await reenviarConfirmacao({ token: g.token }, deps(agora).d)).toEqual(UNIFORME);
    expect([await totalTokens(), await totalEmails()]).toEqual([tokens, enviados]);
  });

  it('CA-15: e-mail inexistente, profissional, gestor confirmado → mesma mensagem e nada gravado', async () => {
    const tokens = await totalTokens();
    const enviados = await totalEmails();
    for (const email of [emailNovo(), s.profissional.email, s.gestor.email]) {
      expect(await reenviarConfirmacao({ email }, deps(T0).d)).toEqual(UNIFORME);
    }
    expect(await reenviarConfirmacao({ token: novoTokenDeConfirmacao(T0).token }, deps(T0).d)).toEqual(UNIFORME);
    expect([await totalTokens(), await totalEmails()]).toEqual([tokens, enviados]);
  });

  it('RN-15: falha do adaptador no reenvio → resposta uniforme; o token novo fica gravado', async () => {
    const g = await gestor();
    const falha = {
      enviar: async () => {
        throw new Error('smtp fora');
      },
    };
    const { linhas, d } = deps(T0, { email: falha });
    expect(await reenviarConfirmacao({ email: g.email }, d)).toEqual(UNIFORME);
    expect(await tokensDe(g.usuarioId)).toHaveLength(2);
    expect(await emails(g.email)).toEqual([]);
    expect(JSON.parse(linhas[0])).toEqual({
      evento: 'auth.reenvio_confirmacao',
      resultado: 'envio_falhou',
      usuarioId: g.usuarioId,
      em: T0.toISOString(),
    });
  });
});

describe('CA-16: limite de 3 pedidos por e-mail em janela fixa de 15 min', () => {
  it('CA-16: existente não confirmado — 3 enviam, o 4º é recusado sem token nem e-mail; a janela seguinte volta a enviar', async () => {
    const g = await gestor();
    const janela = new Date(Math.ceil(T0.getTime() / JANELA_MS) * JANELA_MS + 2 * JANELA_MS);
    for (let i = 0; i < LIMITE_REENVIO; i++) {
      expect(await reenviarConfirmacao({ email: g.email }, deps(new Date(janela.getTime() + i * 1000)).d)).toEqual(UNIFORME);
    }
    expect(await emails(g.email)).toHaveLength(3);
    const tokens = await totalTokens();
    expect(await reenviarConfirmacao({ email: g.email }, deps(new Date(janela.getTime() + 5000)).d)).toEqual(LIMITE);
    // Pelo token também conta na chave do e-mail do dono.
    expect(await reenviarConfirmacao({ token: g.token }, deps(new Date(janela.getTime() + 6000)).d)).toEqual(LIMITE);
    expect(await emails(g.email)).toHaveLength(3);
    expect(await totalTokens()).toBe(tokens);
    const r = await c.query('SELECT contador FROM rate_limit_janela WHERE chave = $1 AND janela_inicio = $2', [
      chaveDeReenvio(g.email),
      inicioDaJanela(janela),
    ]);
    expect(r.rows).toEqual([{ contador: 5 }]);

    const seguinte = new Date(janela.getTime() + JANELA_MS);
    expect(await reenviarConfirmacao({ email: g.email }, deps(seguinte).d)).toEqual(UNIFORME);
    expect(await emails(g.email)).toHaveLength(4);
  });

  it('CA-16: e-mail inexistente — 3 uniformes e o 4º limite (mesma regra, não revela existência)', async () => {
    const email = emailNovo();
    const rs = [];
    for (let i = 0; i < 4; i++) rs.push(await reenviarConfirmacao({ email }, deps(T0).d));
    expect(rs).toEqual([UNIFORME, UNIFORME, UNIFORME, LIMITE]);
    expect(await emails(email)).toEqual([]);
  });
});

describe('CA-19: logs sem dados pessoais', () => {
  it('CA-19: confirmação e reenvio emitem auth.* sem e-mail, token nem hash', async () => {
    const g = await gestor();
    const { linhas, d } = deps(new Date(T0.getTime() + HORA_MS));
    await reenviarConfirmacao({ email: g.email }, d);
    await reenviarConfirmacao({ email: emailNovo() }, d);
    await reenviarConfirmacao({ email: 'invalido' }, d);
    const [m] = await emails(g.email);
    const novo = tokenDoCorpo(m.corpo);
    await confirmarEmail(g.token, d);
    await confirmarEmail(novo, d);
    const eventos = linhas.map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(eventos.map((e) => [e.evento, e.resultado])).toEqual([
      ['auth.reenvio_confirmacao', 'enviado'],
      ['auth.reenvio_confirmacao', 'ignorado'],
      ['auth.reenvio_confirmacao', 'validacao'],
      ['auth.confirmacao_email', 'expirado_ou_substituido'],
      ['auth.confirmacao_email', 'confirmado'],
    ]);
    const tudo = linhas.join('\n');
    for (const segredo of [g.email, g.token, g.tokenHash, novo, hashDoToken(novo), chaveDeReenvio(g.email)]) {
      expect(tudo).not.toContain(segredo);
    }
    for (const e of eventos) {
      expect(Object.keys(e).every((k) => ['evento', 'resultado', 'usuarioId', 'salaoId', 'em'].includes(k))).toBe(true);
    }
  });
});
