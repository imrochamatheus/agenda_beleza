import type pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { MENSAGENS_CONVITE, aceitarConvite } from '@/server/auth/convite';
import type { ResultadoAceite } from '@/server/auth/convite';
import { convidar } from '@/server/convites/servico';
import { desativarProfissional, editarProfissional } from '@/server/profissionais/profissionais.acao';

import { credencialDoGestor } from '../../support/auth';
import { criarSalaoCompleto } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import {
  APP_URL,
  T0,
  convitesDe,
  emitirConvite,
  linhasDeUsuario,
  novoProfissionalSemAcesso,
  pendentes,
} from '../../support/convites';
import { conectar, emailNovo } from '../../support/sql';
import { ctxDoGestor } from '../profissionais/apoio';

// D-039 CA-6, CA-7, CA-8 e a ordem de travas: aceite × aceite, reenvio × aceite, desativação × aceite,
// edição de e-mail × aceite e usuário novo × aceite, contra PostgreSQL real. Sem 5xx (nada lança) nem
// impasse; nunca dois pendentes nem usuário criado por link invalidado.

const SENHA = 'uma-senha-forte-1';
const RODADAS = 10;

let c: pg.Client;
let a: SalaoCompleto;
let gestor: Awaited<ReturnType<typeof credencialDoGestor>>;

beforeAll(async () => {
  c = await conectar();
  a = await criarSalaoCompleto();
  gestor = await credencialDoGestor(a);
});
afterAll(async () => {
  await c.end();
});
afterEach(() => {
  vi.restoreAllMocks();
});

const deps = { agora: T0, log: () => {} };
const aceitar = (token: string) => aceitarConvite({ token, senha: SENHA }, deps);
const foi = (r: ResultadoAceite) => r.resultado === 'aceito';

async function convidada() {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  const p = await novoProfissionalSemAcesso(c, a.salaoId);
  const { token } = await emitirConvite(ctxDoGestor(a), p.id, T0);
  return { ...p, token };
}

async function vinculo(id: string): Promise<string | null> {
  const { rows } = await c.query<{ u: string | null }>('SELECT usuario_id::text AS u FROM profissional WHERE id = $1', [id]);
  return rows[0].u;
}

describe('CA-6: aceite × aceite', () => {
  it.each([2, 10])('%i aceites simultâneos do mesmo link: exatamente um sucede, os outros são recusados, 1 só usuário', async (n) => {
    for (let rodada = 0; rodada < (n === 10 ? 3 : 5); rodada++) {
      const p = await convidada();
      const rs = await Promise.all(Array.from({ length: n }, () => aceitar(p.token)));
      expect(rs.filter(foi), `rodada ${rodada}`).toHaveLength(1);
      for (const r of rs.filter((x) => !foi(x))) {
        expect(r).toEqual({ resultado: 'recusado', mensagem: MENSAGENS_CONVITE.recusado, detalhe: expect.stringMatching(/^(ja_utilizado)$/) });
      }
      expect(await linhasDeUsuario(c, p.email!)).toHaveLength(1);
      expect(pendentes(await convitesDe(c, p.id))).toHaveLength(0);
    }
  });
});

describe('CA-7: reenvio × aceite', () => {
  it(`em ${RODADAS} rodadas, ou o aceite vence (reenvio recusa) ou o reenvio vence (aceite recusado); nunca dois pendentes`, async () => {
    const vencedores = new Set<string>();
    for (let i = 0; i < RODADAS; i++) {
      const p = await convidada();
      const [r, ac] = await Promise.all([
        convidar(ctxDoGestor(a), { id: p.id }, new Date(T0.getTime() + 1000), { appUrl: APP_URL, log: () => {} }),
        aceitar(p.token),
      ]);
      const u = await linhasDeUsuario(c, p.email!);
      const linhas = await convitesDe(c, p.id);
      expect(pendentes(linhas).length).toBeLessThanOrEqual(1);
      if (foi(ac)) {
        vencedores.add('aceite');
        expect(u).toHaveLength(1);
        expect(r).toEqual({ resultado: 'invalido', erros: { formulario: MENSAGENS_CONVITE.jaTemAcesso } });
        expect(pendentes(linhas)).toHaveLength(0);
      } else {
        vencedores.add('reenvio');
        expect(r).toMatchObject({ resultado: 'criado' });
        expect(ac).toMatchObject({ resultado: 'recusado', detalhe: 'invalidado' });
        expect(u).toHaveLength(0);
        expect(pendentes(linhas)).toHaveLength(1);
        expect(await vinculo(p.id)).toBeNull();
      }
    }
    expect(vencedores.size).toBeGreaterThan(0);
  });
});

describe('desativação × aceite e edição de e-mail × aceite', () => {
  it('desativar e aceitar em paralelo: usuário só existe se o aceite venceu; nunca 5xx', async () => {
    for (let i = 0; i < RODADAS; i++) {
      const p = await convidada();
      const [d, ac] = await Promise.all([desativarProfissional.executar(gestor, { id: p.id }, { agora: T0 }), aceitar(p.token)]);
      expect(d).toMatchObject({ ok: true, dados: { resultado: 'desativado' } });
      const u = await linhasDeUsuario(c, p.email!);
      expect(u).toHaveLength(foi(ac) ? 1 : 0);
      expect(await vinculo(p.id)).toBe(foi(ac) ? u[0]?.id : null);
      if (!foi(ac)) expect(ac).toMatchObject({ resultado: 'recusado' });
      expect(pendentes(await convitesDe(c, p.id))).toHaveLength(0);
    }
  });

  it('trocar o e-mail do perfil e aceitar em paralelo: ou o aceite vence (troca recusada) ou a troca vence (aceite recusado)', async () => {
    for (let i = 0; i < RODADAS; i++) {
      const p = await convidada();
      const novo = emailNovo();
      const [e, ac] = await Promise.all([editarProfissional.executar(gestor, { id: p.id, nome: 'Troca', email: novo }, { agora: T0 }), aceitar(p.token)]);
      expect(e.ok).toBe(true);
      const u = await linhasDeUsuario(c, p.email!);
      if (foi(ac)) {
        expect(u).toHaveLength(1);
        expect(e).toMatchObject({ dados: { resultado: 'invalido' } });
        expect((await c.query('SELECT email FROM profissional WHERE id = $1', [p.id])).rows[0].email).toBe(p.email);
      } else {
        expect(u).toHaveLength(0);
        expect(e).toMatchObject({ dados: { resultado: 'salvo' } });
        expect(await linhasDeUsuario(c, novo)).toHaveLength(0);
        expect(pendentes(await convitesDe(c, p.id))).toHaveLength(0);
      }
    }
  });
});

describe('CA-8: usuário novo com o mesmo e-mail × aceite', () => {
  it('o INSERT concorrente e o aceite: um só usuário, sem 23505 vazando', async () => {
    for (let i = 0; i < RODADAS; i++) {
      const p = await convidada();
      const inserir = c.query(
        `INSERT INTO usuario (salao_id, papel, email, nome, senha_hash) VALUES (NULL, 'super_admin', $1, 'Rival', 'x') ON CONFLICT (email) DO NOTHING`,
        [p.email],
      );
      const [, ac] = await Promise.all([inserir, aceitar(p.token)]);
      const u = await linhasDeUsuario(c, p.email!);
      expect(u).toHaveLength(1);
      expect(foi(ac)).toBe(u[0].papel === 'profissional');
      if (!foi(ac)) expect(ac).toMatchObject({ resultado: 'recusado', detalhe: expect.stringMatching(/^email_em_uso$/) });
    }
  });
});

describe('ordem de travas (pg_stat_activity)', () => {
  async function esperarBloqueio(trecho: string): Promise<void> {
    for (let i = 0; i < 100; i++) {
      const { rows } = await c.query(
        `SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query ILIKE $1`,
        [`%${trecho}%`],
      );
      if (rows.length > 0) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`nenhuma sessão esperando por: ${trecho}`);
  }

  it('o aceite espera a trava do profissional ANTES de tocar convite ou usuário; um reenvio que vence invalida o link', async () => {
    const p = await convidada();
    const outro = await conectar();
    try {
      await outro.query('BEGIN');
      await outro.query('SELECT id FROM profissional WHERE id = $1 FOR NO KEY UPDATE', [p.id]);
      const aceite = aceitar(p.token);
      await esperarBloqueio('FOR UPDATE OF p');
      expect(await linhasDeUsuario(c, p.email!)).toHaveLength(0);
      await outro.query('UPDATE convite SET invalidado_em = now() WHERE profissional_id = $1 AND aceito_em IS NULL', [p.id]);
      await outro.query('COMMIT');
      expect(await aceite).toMatchObject({ resultado: 'recusado', detalhe: 'invalidado' });
      expect(await linhasDeUsuario(c, p.email!)).toHaveLength(0);
    } finally {
      await outro.query('ROLLBACK').catch(() => undefined);
      await outro.end();
    }
  });

  it('o envio (FOR NO KEY UPDATE) espera quem já tem o profissional; sem impasse, e ao liberar vê o vínculo', async () => {
    const p = await convidada();
    const outro = await conectar();
    try {
      await outro.query('BEGIN');
      await outro.query('SELECT id FROM profissional WHERE id = $1 FOR UPDATE', [p.id]);
      const envio = convidar(ctxDoGestor(a), { id: p.id }, new Date(T0.getTime() + 5000), { appUrl: APP_URL, log: () => {} });
      await esperarBloqueio('FOR NO KEY UPDATE OF p');
      const { rows } = await c.query(`INSERT INTO usuario (salao_id, papel, email, nome, senha_hash) VALUES ($1, 'profissional', $2, 'V', 'x') RETURNING id::text AS id`, [a.salaoId, emailNovo()]);
      await outro.query('UPDATE profissional SET usuario_id = $2 WHERE id = $1', [p.id, rows[0].id]);
      await outro.query('COMMIT');
      expect(await envio).toEqual({ resultado: 'invalido', erros: { formulario: MENSAGENS_CONVITE.jaTemAcesso } });
    } finally {
      await outro.query('ROLLBACK').catch(() => undefined);
      await outro.end();
    }
  });
});
