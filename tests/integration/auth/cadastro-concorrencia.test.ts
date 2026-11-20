import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MENSAGENS_CADASTRO, cadastrar } from '@/server/auth/cadastro';
import type { CampoCadastro } from '@/server/auth/cadastro';
import { confirmarEmail, reenviarConfirmacao } from '@/server/auth/confirmacao-email';

import { conectar, emailNovo } from '../../support/sql';

// D-011 T-4: concorrência real contra PostgreSQL (Promise.all sobre o pool do Prisma), 10 repetições
// por cenário dentro do arquivo. CA-11 (duplo envio), CA-12 (mesmo nome em paralelo), CA-14 (dupla
// abertura do link) e a corrida reenvio × consumo (nunca dois tokens válidos; nunca confirmado com
// pendente válido). Literais de slug deste arquivo: `studio-bela-<n>`.

const REPETICOES = 10;
const APP_URL = 'http://app.teste';
const T0 = new Date('2026-11-19T12:00:00.000Z');
const silencioso = { log: () => {} };

let c: pg.Client;

beforeAll(async () => {
  c = await conectar();
});
afterAll(async () => {
  await c.end();
});

async function n(sql: string, params: unknown[] = []): Promise<number> {
  return Number((await c.query<{ n: string }>(sql, params)).rows[0].n);
}

function entrada(parcial: Partial<Record<CampoCadastro, unknown>> = {}): Record<CampoCadastro, unknown> {
  return { nome: 'Gestora Paralela', email: emailNovo(), senha: 'senha-forte-1', nomeSalao: 'Salão Paralelo', ...parcial };
}

async function tokenDoEmail(email: string): Promise<string> {
  const r = await c.query<{ corpo: string }>(
    'SELECT corpo FROM email_log WHERE destinatario = $1 ORDER BY criado_em DESC, id DESC LIMIT 1',
    [email],
  );
  const m = /confirmar-email\?token=([A-Za-z0-9_-]{43})/.exec(r.rows[0].corpo);
  return m![1];
}

async function cadastrado(): Promise<{ email: string; token: string; usuarioId: string }> {
  const e = entrada();
  const r = await cadastrar(e, { agora: T0, appUrl: APP_URL, ...silencioso });
  if (!r.ok) throw new Error('falha ao preparar');
  const u = await c.query<{ id: string }>('SELECT id FROM usuario WHERE email = $1', [r.email]);
  return { email: r.email, token: await tokenDoEmail(r.email), usuarioId: u.rows[0].id };
}

describe('CA-11: duplo envio do mesmo formulário', () => {
  it(`CA-11: ${REPETICOES}× — 1 salão, 1 gestor, 1 token e 1 e-mail; uma resposta ok e a outra email_existente`, async () => {
    for (let i = 0; i < REPETICOES; i++) {
      const e = entrada({ nomeSalao: `Duplo Envio ${i}` });
      const salaoAntes = await n('SELECT count(*) AS n FROM salao');
      const rs = await Promise.all([
        cadastrar(e, { agora: T0, appUrl: APP_URL, ...silencioso }),
        cadastrar(e, { agora: T0, appUrl: APP_URL, ...silencioso }),
      ]);
      const email = e.email as string;
      expect(rs.filter((r) => r.ok), `repetição ${i}`).toEqual([{ ok: true, email, envio: 'enviado' }]);
      expect(rs.filter((r) => !r.ok)).toEqual([
        { ok: false, motivo: 'email_existente', erros: { email: MENSAGENS_CADASTRO.emailExistente } },
      ]);
      expect(await n('SELECT count(*) AS n FROM salao')).toBe(salaoAntes + 1);
      expect(await n('SELECT count(*) AS n FROM usuario WHERE email = $1', [email])).toBe(1);
      expect(
        await n('SELECT count(*) AS n FROM token t JOIN usuario u ON u.id = t.usuario_id WHERE u.email = $1', [email]),
      ).toBe(1);
      expect(await n('SELECT count(*) AS n FROM email_log WHERE destinatario = $1', [email])).toBe(1);
      expect(await n(`SELECT count(*) AS n FROM salao WHERE nome = $1`, [`Duplo Envio ${i}`])).toBe(1);
    }
  });
});

describe('CA-12: mesmo nome de salão em paralelo', () => {
  it(`CA-12: ${REPETICOES}× — os dois cadastros são efetivados com {base, base-2}`, async () => {
    for (let i = 0; i < REPETICOES; i++) {
      const nomeSalao = `Studio Bela ${i + 10}`;
      const rs = await Promise.all([
        cadastrar(entrada({ nomeSalao }), { agora: T0, appUrl: APP_URL, ...silencioso }),
        cadastrar(entrada({ nomeSalao }), { agora: T0, appUrl: APP_URL, ...silencioso }),
      ]);
      expect(rs.every((r) => r.ok), `repetição ${i}`).toBe(true);
      const slugs = await c.query<{ slug: string }>(
        'SELECT ss.slug FROM salao_slug ss JOIN salao s ON s.id = ss.salao_id WHERE s.nome = $1 ORDER BY ss.slug',
        [nomeSalao],
      );
      expect(slugs.rows.map((r) => r.slug)).toEqual([`studio-bela-${i + 10}`, `studio-bela-${i + 10}-2`]);
    }
  });
});

describe('CA-14: dupla abertura simultânea do link', () => {
  it(`CA-14: ${REPETICOES}× — exatamente um "confirmado" e um "já utilizado"; usado_em gravado uma vez`, async () => {
    for (let i = 0; i < REPETICOES; i++) {
      const g = await cadastrado();
      const agora = new Date(T0.getTime() + 60_000);
      const rs = await Promise.all([confirmarEmail(g.token, { agora, ...silencioso }), confirmarEmail(g.token, { agora, ...silencioso })]);
      expect(rs.sort(), `repetição ${i}`).toEqual(['confirmado', 'ja_utilizado']);
      expect(await n('SELECT count(*) AS n FROM token WHERE usuario_id = $1 AND usado_em IS NOT NULL', [g.usuarioId])).toBe(1);
    }
  });
});

describe('Corrida reenvio × consumo (spec §6, R-1)', () => {
  it(`${REPETICOES}× — vale o primeiro; nunca dois tokens válidos nem confirmado com pendente válido`, async () => {
    const vistos = new Set<string>();
    for (let i = 0; i < REPETICOES; i++) {
      const g = await cadastrado();
      const agora = new Date(T0.getTime() + 60_000);
      const [consumo, reenvio] = await Promise.all([
        confirmarEmail(g.token, { agora, ...silencioso }),
        reenviarConfirmacao({ email: g.email }, { agora, appUrl: APP_URL, ...silencioso }),
      ]);
      expect(reenvio.ok).toBe(true);
      vistos.add(consumo);
      const u = await c.query<{ confirmado: boolean }>(
        'SELECT email_confirmado_em IS NOT NULL AS confirmado FROM usuario WHERE id = $1',
        [g.usuarioId],
      );
      const validos = await n(
        `SELECT count(*) AS n FROM token WHERE usuario_id = $1 AND tipo = 'confirmacao_email'
            AND usado_em IS NULL AND invalidado_em IS NULL AND expira_em > $2`,
        [g.usuarioId, agora],
      );
      const emails = await n('SELECT count(*) AS n FROM email_log WHERE destinatario = $1', [g.email]);
      if (consumo === 'confirmado') {
        // Consumo primeiro: o reenvio viu o usuário confirmado e não emitiu nem enviou nada.
        expect([u.rows[0].confirmado, validos, emails], `repetição ${i}`).toEqual([true, 0, 1]);
      } else {
        // Reenvio primeiro: A ficou substituído; existe exatamente um token válido (B) e o e-mail dele.
        expect(consumo).toBe('expirado_ou_substituido');
        expect([u.rows[0].confirmado, validos, emails], `repetição ${i}`).toEqual([false, 1, 2]);
      }
    }
    expect([...vistos].every((v) => ['confirmado', 'expirado_ou_substituido'].includes(v))).toBe(true);
  });
});
