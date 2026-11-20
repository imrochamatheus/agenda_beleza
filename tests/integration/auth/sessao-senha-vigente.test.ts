import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MENSAGENS_LOGIN, chaveDeLogin, entrar, inicioDaJanela } from '@/server/auth/login';
import { gerarHashSenha, verificarSenha } from '@/server/auth/senha';
import { iniciarSessao, iniciarSessaoSeSenhaVigente } from '@/server/auth/sessao';
import { expiracaoInicial } from '@/server/auth/validade';
import { buscarSessaoValida, criarSessaoSeSenhaVigente } from '@/server/repos/sessao';
import { hashDoToken } from '@/server/tenant/sessao';

import { SENHA_DE_TESTE, criarSalaoCompleto, hashDaSenhaDeTeste } from '../../support/factories';
import { conectar } from '../../support/sql';

// D-012 T-2 (RN-13, D-11, D-19): a sessão do login só nasce se `usuario.senha_hash` ainda é o hash
// verificado. Repositório (true/false), serviço de sessão e o login com um verificador
// instrumentado que troca o hash ENTRE a verificação e a criação da sessão (CA-16, versão
// sequencial; a concorrente real está em recuperacao-senha-concorrencia.test.ts).

const T0 = new Date('2026-11-19T12:00:00.000Z');
const silencioso = { log: () => {} };

let c: pg.Client;

beforeAll(async () => {
  c = await conectar();
});
afterAll(async () => {
  await c.end();
});

async function sessoesDe(usuarioId: string): Promise<{ token_hash: string; criado_em: Date; ultimo_uso_em: Date; expira_em: Date }[]> {
  const r = await c.query('SELECT token_hash, criado_em, ultimo_uso_em, expira_em FROM sessao WHERE usuario_id = $1 ORDER BY criado_em, id', [
    usuarioId,
  ]);
  return r.rows;
}

async function contador(email: string, agora: Date): Promise<number | null> {
  const r = await c.query<{ contador: number }>('SELECT contador FROM rate_limit_janela WHERE chave = $1 AND janela_inicio = $2', [
    chaveDeLogin(email),
    inicioDaJanela(agora),
  ]);
  return r.rows[0]?.contador ?? null;
}

describe('criarSessaoSeSenhaVigente (repositório)', () => {
  it('hash vigente → true e grava a sessão com o relógio injetado; hash diferente ou usuário ausente → false, nada gravado', async () => {
    const s = await criarSalaoCompleto();
    const hash = await hashDaSenhaDeTeste();
    const expiraEm = expiracaoInicial(T0);

    expect(
      await criarSessaoSeSenhaVigente({ usuarioId: s.gestor.usuarioId, tokenHash: hashDoToken('a'), agora: T0, expiraEm, senhaHash: hash }),
    ).toBe(true);
    expect(await sessoesDe(s.gestor.usuarioId)).toEqual([
      { token_hash: hashDoToken('a'), criado_em: T0, ultimo_uso_em: T0, expira_em: expiraEm },
    ]);

    expect(
      await criarSessaoSeSenhaVigente({
        usuarioId: s.gestor.usuarioId,
        tokenHash: hashDoToken('b'),
        agora: T0,
        expiraEm,
        senhaHash: `${hash}x`,
      }),
    ).toBe(false);
    expect(
      await criarSessaoSeSenhaVigente({
        usuarioId: '00000000-0000-4000-8000-000000000000',
        tokenHash: hashDoToken('c'),
        agora: T0,
        expiraEm,
        senhaHash: hash,
      }),
    ).toBe(false);
    expect(await sessoesDe(s.gestor.usuarioId)).toHaveLength(1);
    const r = await c.query('SELECT count(*)::int AS n FROM sessao WHERE token_hash = ANY($1)', [[hashDoToken('b'), hashDoToken('c')]]);
    expect(r.rows[0].n).toBe(0);
  });
});

describe('iniciarSessaoSeSenhaVigente (serviço de sessão)', () => {
  it('hash vigente → token que resolve a sessão; hash trocado → null e nenhuma sessão nova', async () => {
    const s = await criarSalaoCompleto();
    const hash = await hashDaSenhaDeTeste();
    const agora = new Date();
    const ok = await iniciarSessaoSeSenhaVigente(s.profissional.usuarioId, hash, agora);
    expect(ok).not.toBeNull();
    expect(ok!.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect((await buscarSessaoValida(hashDoToken(ok!.token), agora))?.usuarioId).toBe(s.profissional.usuarioId);

    expect(await iniciarSessaoSeSenhaVigente(s.profissional.usuarioId, 'outro-hash', agora)).toBeNull();
    expect(await sessoesDe(s.profissional.usuarioId)).toHaveLength(1);
  });

  it('iniciarSessao (incondicional) continua criando sessão para suporte e testes', async () => {
    const s = await criarSalaoCompleto();
    const agora = new Date();
    const { token } = await iniciarSessao(s.gestor.usuarioId, agora);
    expect((await buscarSessaoValida(hashDoToken(token), agora))?.usuarioId).toBe(s.gestor.usuarioId);
  });
});

describe('CA-16 / D-19: login cujo hash muda entre a verificação e a sessão', () => {
  it('senha antiga verificada, hash trocado antes da sessão → "E-mail ou senha incorretos.", sem sessão, conta como falha', async () => {
    const s = await criarSalaoCompleto();
    const novoHash = await gerarHashSenha('nova-senha-9');
    const verificarETrocar = async (hash: string, senha: string) => {
      const ok = await verificarSenha(hash, senha);
      // Simula a redefinição que comita entre a verificação e a criação da sessão.
      await c.query('UPDATE usuario SET senha_hash = $1 WHERE id = $2', [novoHash, s.gestor.usuarioId]);
      return ok;
    };
    const r = await entrar(
      { email: s.gestor.email, senha: SENHA_DE_TESTE },
      { agora: T0, verificarSenha: verificarETrocar, ...silencioso },
    );
    expect(r).toEqual({ ok: false, motivo: 'recusado', mensagem: MENSAGENS_LOGIN.credenciais });
    expect(await sessoesDe(s.gestor.usuarioId)).toEqual([]);
    // Falha: a reserva do limite não é devolvida.
    expect(await contador(s.gestor.email, T0)).toBe(1);
  });

  it('log da recusa por hash trocado: resultado "credenciais", sem senha nem hash', async () => {
    const s = await criarSalaoCompleto();
    const linhas: string[] = [];
    const r = await entrar(
      { email: s.gestor.email, senha: SENHA_DE_TESTE },
      {
        agora: T0,
        verificarSenha: async (hash, senha) => {
          const ok = await verificarSenha(hash, senha);
          await c.query(`UPDATE usuario SET senha_hash = 'trocado' WHERE id = $1`, [s.gestor.usuarioId]);
          return ok;
        },
        log: (l) => linhas.push(l),
      },
    );
    expect(r.ok).toBe(false);
    expect(linhas.map((l) => JSON.parse(l))).toEqual([{ evento: 'auth.login', resultado: 'credenciais', em: T0.toISOString() }]);
    expect(linhas.join('\n')).not.toContain(SENHA_DE_TESTE);
  });

  it('contraprova: login normal cria a sessão e devolve a reserva (contador 0)', async () => {
    const s = await criarSalaoCompleto();
    const r = await entrar({ email: s.gestor.email, senha: SENHA_DE_TESTE }, { agora: T0, ...silencioso });
    expect(r.ok).toBe(true);
    expect(await sessoesDe(s.gestor.usuarioId)).toHaveLength(1);
    expect(await contador(s.gestor.email, T0)).toBe(0);
  });
});
