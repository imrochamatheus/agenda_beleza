import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MENSAGENS_LOGIN, entrar } from '@/server/auth/login';
import { MENSAGENS_RECUPERACAO, redefinirSenha, solicitarRecuperacao } from '@/server/auth/recuperacao-senha';
import { verificarSenha } from '@/server/auth/senha';

import { SENHA_DE_TESTE, criarSalaoCompleto } from '../../support/factories';
import { conectar } from '../../support/sql';

// D-012 T-4: concorrência real contra PostgreSQL (Promise.all sobre o pool do Prisma), 10
// repetições por cenário dentro do arquivo. CA-11a (duplo envio do mesmo token), CA-11b
// (solicitação × redefinição: nunca dois tokens válidos) e CA-16 (login com a senha antiga ×
// redefinição: nunca sobra sessão válida), com e sem o portão que atrasa o verificador do login.

const REPETICOES = 10;
// DEF-1 (D-012 rodada 1): cada `it` faz 10 repetições com argon2 (~2 s isolado); sob 4 workers da
// suíte completa passava dos 5 s padrão. Prazo explícito e folgado por teste, sem mudar o global.
const PRAZO_MS = 30_000;
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

/** Gestor novo com um link de recuperação válido (emitido em T0). */
async function comLink(): Promise<{ usuarioId: string; email: string; token: string }> {
  const s = await criarSalaoCompleto();
  const r = await solicitarRecuperacao({ email: s.gestor.email }, { agora: T0, appUrl: APP_URL, ...silencioso });
  expect(r.ok).toBe(true);
  const m = await c.query<{ corpo: string }>('SELECT corpo FROM email_log WHERE destinatario = $1 ORDER BY criado_em DESC, id DESC LIMIT 1', [
    s.gestor.email,
  ]);
  const token = /redefinir-senha\?token=([A-Za-z0-9_-]{43})/.exec(m.rows[0].corpo)![1];
  return { usuarioId: s.gestor.usuarioId, email: s.gestor.email, token };
}

const validos = (usuarioId: string, agora: Date) =>
  n(
    `SELECT count(*) AS n FROM token WHERE usuario_id = $1 AND tipo = 'recuperacao_senha'
        AND usado_em IS NULL AND invalidado_em IS NULL AND expira_em > $2`,
    [usuarioId, agora],
  );

const sessoesValidas = (usuarioId: string, agora: Date) =>
  n('SELECT count(*) AS n FROM sessao WHERE usuario_id = $1 AND revogada_em IS NULL AND expira_em > $2', [usuarioId, agora]);

async function senhaHash(usuarioId: string): Promise<string> {
  return (await c.query<{ senha_hash: string }>('SELECT senha_hash FROM usuario WHERE id = $1', [usuarioId])).rows[0].senha_hash;
}

describe('CA-11a: dois envios do mesmo token em paralelo', () => {
  it(`CA-11a: ${REPETICOES}× — exatamente 1 sucesso e 1 recusa; usado_em uma vez; hash final = senha do vencedor`, async () => {
    for (let i = 0; i < REPETICOES; i++) {
      const g = await comLink();
      const agora = new Date(T0.getTime() + 60_000);
      const senhas = [`senha-um-${i}-x`, `senha-dois-${i}-x`];
      const rs = await Promise.all(senhas.map((senha) => redefinirSenha({ token: g.token, senha }, { agora, ...silencioso })));
      const vencedor = rs.findIndex((r) => r.ok);
      expect(rs.filter((r) => r.ok), `repetição ${i}`).toEqual([{ ok: true, mensagem: MENSAGENS_RECUPERACAO.sucesso }]);
      const perdedor = rs[1 - vencedor];
      expect(perdedor).toMatchObject({ ok: false, motivo: 'recusado', mensagem: MENSAGENS_RECUPERACAO.recusado });
      expect(await n('SELECT count(*) AS n FROM token WHERE usuario_id = $1 AND usado_em IS NOT NULL', [g.usuarioId])).toBe(1);
      const hash = await senhaHash(g.usuarioId);
      expect(await verificarSenha(hash, senhas[vencedor])).toBe(true);
      expect(await verificarSenha(hash, senhas[1 - vencedor])).toBe(false);
    }
  }, PRAZO_MS);
});

describe('CA-11b: solicitação nova × redefinição', () => {
  it(`CA-11b: ${REPETICOES}× — vale a primeira a travar o usuário; ao final, exatamente 1 token válido`, async () => {
    const vistos = new Set<string>();
    for (let i = 0; i < REPETICOES; i++) {
      const g = await comLink();
      const hashAntes = await senhaHash(g.usuarioId);
      const agora = new Date(T0.getTime() + 60_000);
      const [redefinicao, solicitacao] = await Promise.all([
        redefinirSenha({ token: g.token, senha: `nova-senha-${i}` }, { agora, ...silencioso }),
        solicitarRecuperacao({ email: g.email }, { agora, appUrl: APP_URL, ...silencioso }),
      ]);
      expect(solicitacao.ok).toBe(true);
      expect(await validos(g.usuarioId, agora), `repetição ${i}`).toBe(1);
      const [antigo] = (
        await c.query<{ usado_em: Date | null; invalidado_em: Date | null }>(
          `SELECT usado_em, invalidado_em FROM token WHERE usuario_id = $1 ORDER BY criado_em, id LIMIT 1`,
          [g.usuarioId],
        )
      ).rows;
      if (redefinicao.ok) {
        // Redefinição primeiro: o token antigo foi usado; o novo nasceu depois e continua válido.
        vistos.add('redefinicao');
        expect([antigo.usado_em, antigo.invalidado_em]).toEqual([agora, null]);
        expect(await senhaHash(g.usuarioId)).not.toBe(hashAntes);
      } else {
        // Solicitação primeiro: o antigo foi substituído e a redefinição recusada sem efeito.
        vistos.add('solicitacao');
        expect(redefinicao).toMatchObject({ motivo: 'recusado', detalhe: 'expirado_ou_substituido' });
        expect([antigo.usado_em, antigo.invalidado_em]).toEqual([null, agora]);
        expect(await senhaHash(g.usuarioId)).toBe(hashAntes);
      }
    }
    expect(vistos.size).toBeGreaterThan(0);
  }, PRAZO_MS);
});

describe('CA-16: login com a senha antiga × redefinição', () => {
  it(`CA-16: ${REPETICOES}× — verificador do login atrasado até depois do commit da redefinição → sem sessão`, async () => {
    for (let i = 0; i < REPETICOES; i++) {
      const g = await comLink();
      const agora = new Date(T0.getTime() + 60_000);
      let verificou!: () => void;
      const verificado = new Promise<void>((r) => (verificou = r));
      let liberar!: () => void;
      const portao = new Promise<void>((r) => (liberar = r));

      const login = entrar(
        { email: g.email, senha: SENHA_DE_TESTE },
        {
          agora,
          ...silencioso,
          verificarSenha: async (hash, senha) => {
            const ok = await verificarSenha(hash, senha);
            verificou();
            await portao;
            return ok;
          },
        },
      );
      await verificado;
      const r = await redefinirSenha({ token: g.token, senha: `nova-senha-${i}` }, { agora, ...silencioso });
      expect(r.ok).toBe(true);
      liberar();
      expect(await login, `repetição ${i}`).toEqual({ ok: false, motivo: 'recusado', mensagem: MENSAGENS_LOGIN.credenciais });
      expect(await sessoesValidas(g.usuarioId, agora)).toBe(0);
    }
  }, PRAZO_MS);

  it(`CA-16: ${REPETICOES}× — login e redefinição disparados juntos, sem portão: nunca sobra sessão válida`, async () => {
    const vistos = new Set<boolean>();
    for (let i = 0; i < REPETICOES; i++) {
      const g = await comLink();
      const agora = new Date(T0.getTime() + 60_000);
      const [login, r] = await Promise.all([
        entrar({ email: g.email, senha: SENHA_DE_TESTE }, { agora, ...silencioso }),
        redefinirSenha({ token: g.token, senha: `nova-senha-${i}` }, { agora, ...silencioso }),
      ]);
      expect(r.ok).toBe(true);
      vistos.add(login.ok);
      if (!login.ok) {
        expect(login).toEqual({ ok: false, motivo: 'recusado', mensagem: MENSAGENS_LOGIN.credenciais });
      }
      // Login antes: a sessão nasceu e foi revogada na mesma transação da troca. Depois: não nasceu.
      expect(await sessoesValidas(g.usuarioId, agora), `repetição ${i}`).toBe(0);
    }
    expect(vistos.size).toBeGreaterThan(0);
  }, PRAZO_MS);
});
