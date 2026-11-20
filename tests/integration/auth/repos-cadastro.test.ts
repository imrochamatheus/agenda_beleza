import { randomUUID } from 'node:crypto';

import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { criarSalaoComGestor, emailJaCadastrado } from '@/server/repos/cadastro';
import type { NovoCadastro } from '@/server/repos/cadastro';
import {
  buscarAlvoPorEmail,
  buscarAlvoPorTokenHash,
  consumirTokenConfirmacao,
  substituirTokenConfirmacao,
} from '@/server/repos/token-confirmacao';
import { hashDoToken } from '@/server/tenant/sessao';

import { criarSalaoCompleto } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { conectar, emailNovo } from '../../support/sql';

// D-011 T-2: repositórios pré-contexto do cadastro e do token de confirmação contra PostgreSQL real.
// ON CONFLICT de e-mail e de slug, nova rodada de slug sob concorrência real (outra conexão grava o
// mesmo candidato numa transação aberta antes e confirmada depois), desfazer em erro, todos os
// resultados do consumo e da substituição e a ordem de travas (usuário → token).
// Slugs literais deste arquivo usam o prefixo `repo-` (únicos por arquivo, R-10).

const HORA_MS = 60 * 60 * 1000;
const T0 = new Date('2026-11-19T12:00:00.000Z');

let c: pg.Client;
let s: SalaoCompleto;

beforeAll(async () => {
  c = await conectar();
  s = await criarSalaoCompleto();
});
afterAll(async () => {
  await c.end();
});

function novo(parcial: Partial<NovoCadastro> = {}): NovoCadastro {
  return {
    nomeSalao: 'Salão do repositório',
    slugBase: `repo-${randomUUID().slice(0, 8)}`,
    nomeGestor: 'Gestora Repo',
    email: emailNovo(),
    senhaHash: '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA',
    tokenHash: hashDoToken(randomUUID()),
    expiraEm: new Date(T0.getTime() + 24 * HORA_MS),
    agora: T0,
    ...parcial,
  };
}

async function contar(tabela: string, where = 'true', params: unknown[] = []): Promise<number> {
  const r = await c.query<{ n: string }>(`SELECT count(*) AS n FROM ${tabela} WHERE ${where}`, params);
  return Number(r.rows[0].n);
}

async function totais(): Promise<number[]> {
  const r: number[] = [];
  for (const t of ['salao', 'salao_slug', 'usuario', 'token']) r.push(await contar(t));
  return r;
}

/** Espera até haver uma sessão desta base aguardando trava (o cadastro bloqueado no índice/linha). */
async function esperarBloqueio(): Promise<void> {
  for (let i = 0; i < 250; i++) {
    const r = await c.query<{ n: string }>(
      `SELECT count(*) AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`,
    );
    if (Number(r.rows[0].n) > 0) return;
    await new Promise((ok) => setTimeout(ok, 20));
  }
  throw new Error('nenhuma sessão ficou aguardando trava');
}

/** Gestor não confirmado com um token pendente; devolve IDs e o hash. */
async function gestorComToken(o: { expiraEm?: Date } = {}) {
  const d = novo({ expiraEm: o.expiraEm ?? new Date(T0.getTime() + 24 * HORA_MS) });
  const r = await criarSalaoComGestor(d);
  if (!r.ok) throw new Error('falha ao preparar');
  return { ...r, tokenHash: d.tokenHash, email: d.email };
}

async function token(tokenHash: string) {
  const r = await c.query<{ usado_em: Date | null; invalidado_em: Date | null }>(
    'SELECT usado_em, invalidado_em FROM token WHERE token_hash = $1',
    [tokenHash],
  );
  return r.rows[0];
}

describe('criarSalaoComGestor', () => {
  it('CA-1: grava salão com defaults, slug atual, gestor não confirmado e token; não devolve hashes', async () => {
    const d = novo({ slugBase: 'repo-studio' });
    const r = await criarSalaoComGestor(d);
    expect(r).toEqual({ ok: true, salaoId: expect.any(String), usuarioId: expect.any(String), slug: 'repo-studio' });
    expect(JSON.stringify(r)).not.toContain(d.tokenHash);
    expect(JSON.stringify(r)).not.toContain(d.senhaHash);
    if (!r.ok) return;
    const salao = await c.query('SELECT nome, fuso, grade_min, antecedencia_min, janela_dias, intervalo_min FROM salao WHERE id = $1', [
      r.salaoId,
    ]);
    expect(salao.rows).toEqual([
      { nome: d.nomeSalao, fuso: 'America/Sao_Paulo', grade_min: 15, antecedencia_min: 120, janela_dias: 60, intervalo_min: 0 },
    ]);
    const slug = await c.query('SELECT slug, atual FROM salao_slug WHERE salao_id = $1', [r.salaoId]);
    expect(slug.rows).toEqual([{ slug: 'repo-studio', atual: true }]);
    const u = await c.query('SELECT salao_id, papel, email, nome, senha_hash, email_confirmado_em FROM usuario WHERE id = $1', [
      r.usuarioId,
    ]);
    expect(u.rows).toEqual([
      { salao_id: r.salaoId, papel: 'gestor', email: d.email, nome: d.nomeGestor, senha_hash: d.senhaHash, email_confirmado_em: null },
    ]);
    const t = await c.query('SELECT usuario_id, tipo, expira_em, criado_em, usado_em, invalidado_em FROM token WHERE token_hash = $1', [
      d.tokenHash,
    ]);
    expect(t.rows).toEqual([
      { usuario_id: r.usuarioId, tipo: 'confirmacao_email', expira_em: d.expiraEm, criado_em: T0, usado_em: null, invalidado_em: null },
    ]);
    expect(await emailJaCadastrado(d.email)).toBe(true);
    expect(await emailJaCadastrado(emailNovo())).toBe(false);
  });

  it('CA-2 (repositório): base ocupada (atual ou histórico) → base-2, depois base-3', async () => {
    await c.query('INSERT INTO salao_slug (slug, salao_id, atual) VALUES ($1, $2, false)', ['repo-hist', s.salaoId]);
    const a = await criarSalaoComGestor(novo({ slugBase: 'repo-hist' }));
    const b = await criarSalaoComGestor(novo({ slugBase: 'repo-hist' }));
    expect([a.ok && a.slug, b.ok && b.slug]).toEqual(['repo-hist-2', 'repo-hist-3']);
  });

  it('CA-7 (repositório): base reservada → painel-2', async () => {
    const r = await criarSalaoComGestor(novo({ slugBase: 'painel' }));
    expect(r.ok && r.slug).toBe('painel-2');
  });

  it('CA-3: e-mail existente → email_existente sem resíduo (o salão criado no passo 1 é desfeito)', async () => {
    const antes = await totais();
    expect(await criarSalaoComGestor(novo({ email: s.gestor.email }))).toEqual({ ok: false, motivo: 'email_existente' });
    expect(await criarSalaoComGestor(novo({ email: s.profissional.email }))).toEqual({ ok: false, motivo: 'email_existente' });
    expect(await totais()).toEqual(antes);
  });

  it('RN-11: slug esgotado (0 rodadas) → slug_esgotado sem resíduo', async () => {
    const antes = await totais();
    const d = novo();
    expect(await criarSalaoComGestor({ ...d, maxRodadasSlug: 0 })).toEqual({ ok: false, motivo: 'slug_esgotado' });
    expect(await totais()).toEqual(antes);
    expect(await emailJaCadastrado(d.email)).toBe(false);
  });

  it('CA-13: token_hash duplicado no passo 4 → erro relançado e nada gravado', async () => {
    const existente = await gestorComToken();
    const antes = await totais();
    const d = novo({ tokenHash: existente.tokenHash });
    await expect(criarSalaoComGestor(d)).rejects.toThrow();
    expect(await totais()).toEqual(antes);
    expect(await contar('salao_slug', 'slug = $1', [d.slugBase])).toBe(0);
  });

  it('CA-11 (repositório): mesmo e-mail em paralelo → um ok e um email_existente; 1 salão', async () => {
    const email = emailNovo();
    const antes = await contar('salao');
    const rs = await Promise.all([criarSalaoComGestor(novo({ email })), criarSalaoComGestor(novo({ email }))]);
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    expect(rs.filter((r) => !r.ok)).toEqual([{ ok: false, motivo: 'email_existente' }]);
    expect(await contar('salao')).toBe(antes + 1);
    expect(await contar('usuario', 'email = $1', [email])).toBe(1);
  });

  it('CA-12 (repositório): nova rodada quando o candidato é gravado por transação concorrente aberta antes', async () => {
    const outro = await conectar();
    try {
      await outro.query('BEGIN');
      const sal = await outro.query<{ id: string }>(`INSERT INTO salao (nome) VALUES ('Concorrente') RETURNING id`);
      await outro.query('INSERT INTO salao_slug (slug, salao_id, atual) VALUES ($1, $2, true)', ['repo-corrida', sal.rows[0].id]);
      // O cadastro não vê o slug ainda não confirmado, escolhe 'repo-corrida' e espera no índice único.
      const p = criarSalaoComGestor(novo({ slugBase: 'repo-corrida' }));
      await esperarBloqueio();
      await outro.query('COMMIT');
      const r = await p;
      expect(r.ok && r.slug).toBe('repo-corrida-2');
    } finally {
      await outro.end();
    }
  });

  it('CA-12 (repositório): mesmo nome em paralelo → base e base-2', async () => {
    const rs = await Promise.all([
      criarSalaoComGestor(novo({ slugBase: 'repo-par' })),
      criarSalaoComGestor(novo({ slugBase: 'repo-par' })),
    ]);
    expect(rs.map((r) => r.ok && r.slug).sort()).toEqual(['repo-par', 'repo-par-2']);
  });
});

describe('buscarAlvoPorEmail e buscarAlvoPorTokenHash', () => {
  it('devolvem o alvo sem hashes; gestor com nome do salão; outro tipo de token → null', async () => {
    const g = await gestorComToken();
    const alvo = await buscarAlvoPorEmail(g.email);
    expect(alvo).toEqual({
      usuarioId: g.usuarioId,
      email: g.email,
      nome: 'Gestora Repo',
      nomeSalao: 'Salão do repositório',
      papel: 'gestor',
      confirmado: false,
    });
    expect(await buscarAlvoPorTokenHash(g.tokenHash)).toEqual(alvo);
    expect(await buscarAlvoPorEmail(emailNovo())).toBeNull();
    expect(await buscarAlvoPorTokenHash(hashDoToken('desconhecido'))).toBeNull();
    expect(await buscarAlvoPorEmail(s.profissional.email)).toMatchObject({ papel: 'profissional', confirmado: true });

    const outroTipo = hashDoToken(randomUUID());
    await c.query(
      `INSERT INTO token (usuario_id, tipo, token_hash, expira_em) VALUES ($1, 'recuperacao_senha', $2, $3)`,
      [g.usuarioId, outroTipo, new Date(T0.getTime() + HORA_MS)],
    );
    expect(await buscarAlvoPorTokenHash(outroTipo)).toBeNull();
  });
});

describe('consumirTokenConfirmacao', () => {
  it('CA-4: confirmado → usado_em e email_confirmado_em = agora, outros pendentes invalidados; reabrir → ja_utilizado', async () => {
    const g = await gestorComToken();
    // Um segundo token pendente (situação anômala) é invalidado pelo consumo.
    const extra = hashDoToken(randomUUID());
    await c.query(`INSERT INTO token (usuario_id, tipo, token_hash, expira_em) VALUES ($1, 'confirmacao_email', $2, $3)`, [
      g.usuarioId,
      extra,
      new Date(T0.getTime() + HORA_MS),
    ]);
    const agora = new Date(T0.getTime() + HORA_MS / 2);
    expect(await consumirTokenConfirmacao(g.tokenHash, agora)).toBe('confirmado');
    expect(await token(g.tokenHash)).toEqual({ usado_em: agora, invalidado_em: null });
    expect(await token(extra)).toEqual({ usado_em: null, invalidado_em: agora });
    const u = await c.query('SELECT email_confirmado_em FROM usuario WHERE id = $1', [g.usuarioId]);
    expect(u.rows[0].email_confirmado_em).toEqual(agora);

    const depois = new Date(agora.getTime() + 1000);
    expect(await consumirTokenConfirmacao(g.tokenHash, depois)).toBe('ja_utilizado');
    expect(await token(g.tokenHash)).toEqual({ usado_em: agora, invalidado_em: null });
    expect(await consumirTokenConfirmacao(extra, depois)).toBe('expirado_ou_substituido');
  });

  it('CA-5: limite exato — T+24h−1ms confirma; T+24h expirado', async () => {
    const a = await gestorComToken();
    const b = await gestorComToken();
    const limite = new Date(T0.getTime() + 24 * HORA_MS);
    expect(await consumirTokenConfirmacao(a.tokenHash, limite)).toBe('expirado_ou_substituido');
    expect(await consumirTokenConfirmacao(b.tokenHash, new Date(limite.getTime() - 1))).toBe('confirmado');
    const u = await c.query('SELECT email_confirmado_em FROM usuario WHERE id = $1', [a.usuarioId]);
    expect(u.rows[0].email_confirmado_em).toBeNull();
  });

  it('CA-14: desconhecido, outro tipo e usuário não gestor → invalido, sem efeito', async () => {
    expect(await consumirTokenConfirmacao(hashDoToken('nada'), T0)).toBe('invalido');
    const g = await gestorComToken();
    const outroTipo = hashDoToken(randomUUID());
    await c.query(`INSERT INTO token (usuario_id, tipo, token_hash, expira_em) VALUES ($1, 'recuperacao_senha', $2, $3)`, [
      g.usuarioId,
      outroTipo,
      new Date(T0.getTime() + HORA_MS),
    ]);
    expect(await consumirTokenConfirmacao(outroTipo, T0)).toBe('invalido');
    expect(await token(outroTipo)).toEqual({ usado_em: null, invalidado_em: null });

    const doProf = hashDoToken(randomUUID());
    await c.query(`INSERT INTO token (usuario_id, tipo, token_hash, expira_em) VALUES ($1, 'confirmacao_email', $2, $3)`, [
      s.profissional.usuarioId,
      doProf,
      new Date(T0.getTime() + HORA_MS),
    ]);
    expect(await consumirTokenConfirmacao(doProf, T0)).toBe('invalido');
    expect(await token(doProf)).toEqual({ usado_em: null, invalidado_em: null });
  });

  it('R-1: trava o usuário antes do token — espera a linha do usuário travada por outra transação', async () => {
    const g = await gestorComToken();
    const outro = await conectar();
    try {
      await outro.query('BEGIN');
      await outro.query('SELECT id FROM usuario WHERE id = $1 FOR UPDATE', [g.usuarioId]);
      const p = consumirTokenConfirmacao(g.tokenHash, T0);
      await esperarBloqueio();
      // Enquanto o consumo espera a linha do usuário, o token ainda não foi tocado.
      expect(await token(g.tokenHash)).toEqual({ usado_em: null, invalidado_em: null });
      await outro.query('COMMIT');
      expect(await p).toBe('confirmado');
    } finally {
      await outro.end();
    }
  });

  it('CA-14 (repositório): duas aberturas simultâneas → um confirmado e um ja_utilizado', async () => {
    const g = await gestorComToken();
    const rs = await Promise.all([consumirTokenConfirmacao(g.tokenHash, T0), consumirTokenConfirmacao(g.tokenHash, T0)]);
    expect(rs.sort()).toEqual(['confirmado', 'ja_utilizado']);
  });
});

describe('substituirTokenConfirmacao', () => {
  it('CA-15: gestor não confirmado → emitido; o anterior (mesmo vencido) é invalidado; o novo é válido', async () => {
    const g = await gestorComToken({ expiraEm: new Date(T0.getTime() - 1) });
    const novoHash = hashDoToken(randomUUID());
    const expiraEm = new Date(T0.getTime() + 24 * HORA_MS);
    expect(await substituirTokenConfirmacao({ usuarioId: g.usuarioId, tokenHash: novoHash, expiraEm, agora: T0 })).toBe('emitido');
    expect(await token(g.tokenHash)).toEqual({ usado_em: null, invalidado_em: T0 });
    expect(await token(novoHash)).toEqual({ usado_em: null, invalidado_em: null });
    expect(await consumirTokenConfirmacao(g.tokenHash, T0)).toBe('expirado_ou_substituido');
    expect(await consumirTokenConfirmacao(novoHash, T0)).toBe('confirmado');
  });

  it('confirmado, não gestor ou inexistente → nao_aplicavel, sem token novo', async () => {
    const antes = await contar('token');
    for (const usuarioId of [s.gestor.usuarioId, s.profissional.usuarioId, randomUUID()]) {
      expect(
        await substituirTokenConfirmacao({
          usuarioId,
          tokenHash: hashDoToken(randomUUID()),
          expiraEm: new Date(T0.getTime() + HORA_MS),
          agora: T0,
        }),
      ).toBe('nao_aplicavel');
    }
    expect(await contar('token')).toBe(antes);
  });
});
