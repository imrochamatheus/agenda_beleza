import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { novoTokenDeConfirmacao } from '@/server/auth/confirmacao-email';
import { MENSAGENS_LOGIN, chaveDeLogin, entrar, inicioDaJanela } from '@/server/auth/login';
import { MENSAGENS_RECUPERACAO, redefinirSenha, solicitarRecuperacao, verificarLinkDeRedefinicao } from '@/server/auth/recuperacao-senha';
import { verificarSenha } from '@/server/auth/senha';

import { criarSessao } from '../../support/auth';
import { SENHA_DE_TESTE, criarSalaoCompleto } from '../../support/factories';
import { conectar } from '../../support/sql';

// D-012 T-8 (tester): regressões independentes do desenvolvedor.
// (1) Risco do arquiteto "falha na transação desfaz tudo e mantém o token válido": o teste do
//     desenvolvedor faz a transação falhar no UPDATE de usuario (antes da invalidação, da
//     revogação das sessões e do DELETE da janela de login). Aqui a falha vem na ÚLTIMA instrução
//     (DELETE em rate_limit_janela, por gatilho no PostgreSQL), depois de todas as outras escritas.
// (2) D-2: gestor com perfil de profissional INATIVO continua elegível (como no login).

const APP_URL = 'http://app.teste';
const T0 = new Date('2026-11-19T12:00:00.000Z');
const AGORA = new Date(T0.getTime() + 60_000);
const NOVA = 'nova-senha-tester-1';
const mudo = { log: () => {} };

let c: pg.Client;

beforeAll(async () => {
  c = await conectar();
});
afterAll(async () => {
  await c.end();
});

async function linkDe(email: string): Promise<string> {
  expect(await solicitarRecuperacao({ email }, { agora: T0, appUrl: APP_URL, ...mudo })).toEqual({
    ok: true,
    mensagem: MENSAGENS_RECUPERACAO.uniforme,
  });
  const m = await c.query<{ corpo: string }>('SELECT corpo FROM email_log WHERE destinatario = $1 ORDER BY criado_em DESC, id DESC LIMIT 1', [email]);
  return /redefinir-senha\?token=([A-Za-z0-9_-]{43})/.exec(m.rows[0].corpo)![1];
}

/** Retrato de tudo o que a redefinição altera para o usuário. */
async function retrato(usuarioId: string, chaveLogin: string) {
  const u = await c.query('SELECT senha_hash, email_confirmado_em, atualizado_em FROM usuario WHERE id = $1', [usuarioId]);
  const t = await c.query('SELECT tipo::text, token_hash, usado_em, invalidado_em FROM token WHERE usuario_id = $1 ORDER BY criado_em, id', [usuarioId]);
  const s = await c.query('SELECT id, revogada_em FROM sessao WHERE usuario_id = $1 ORDER BY id', [usuarioId]);
  const r = await c.query('SELECT chave, janela_inicio, contador FROM rate_limit_janela WHERE chave = $1', [chaveLogin]);
  return { usuario: u.rows, tokens: t.rows, sessoes: s.rows, janela: r.rows };
}

describe('T-8: falha na última instrução da transação de redefinição', () => {
  it('erro no DELETE da janela de login → "falha"; senha, confirmação, tokens, sessões e janela intactos; o link continua válido e depois funciona', async () => {
    const s = await criarSalaoCompleto({ gestor: { emailConfirmado: false } });
    const usuarioId = s.gestor.usuarioId;
    const conf = novoTokenDeConfirmacao(T0);
    await c.query(`INSERT INTO token (usuario_id, tipo, token_hash, expira_em) VALUES ($1, 'confirmacao_email', $2, $3)`, [
      usuarioId,
      conf.tokenHash,
      conf.expiraEm,
    ]);
    await criarSessao(usuarioId);
    await criarSessao(usuarioId);
    const chave = chaveDeLogin(s.gestor.email);
    await c.query('INSERT INTO rate_limit_janela (chave, janela_inicio, contador) VALUES ($1, $2, 4)', [chave, inicioDaJanela(AGORA)]);
    const token = await linkDe(s.gestor.email);
    const antes = await retrato(usuarioId, chave);
    expect(antes.sessoes).toHaveLength(2);
    expect(antes.janela).toHaveLength(1);

    await c.query(`
      CREATE FUNCTION tester_falha_delete_janela() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'falha forçada pelo tester';
      END $$`);
    await c.query('CREATE TRIGGER tester_falha_delete_janela BEFORE DELETE ON rate_limit_janela FOR EACH ROW EXECUTE FUNCTION tester_falha_delete_janela()');
    let r;
    try {
      r = await redefinirSenha({ token, senha: NOVA }, { agora: AGORA, ...mudo });
    } finally {
      await c.query('DROP TRIGGER tester_falha_delete_janela ON rate_limit_janela');
      await c.query('DROP FUNCTION tester_falha_delete_janela()');
    }
    expect(r).toEqual({ ok: false, motivo: 'falha', mensagem: MENSAGENS_RECUPERACAO.falha });
    expect(await retrato(usuarioId, chave)).toEqual(antes);
    expect(await verificarLinkDeRedefinicao(token, { agora: AGORA, ...mudo })).toEqual({ ok: true });

    // Sem o gatilho, o mesmo link funciona e tudo muda de uma vez.
    expect(await redefinirSenha({ token, senha: NOVA }, { agora: AGORA, ...mudo })).toEqual({ ok: true, mensagem: MENSAGENS_RECUPERACAO.sucesso });
    const depois = await retrato(usuarioId, chave);
    expect(depois.janela).toHaveLength(0);
    expect(depois.sessoes.every((x) => x.revogada_em !== null)).toBe(true);
    expect(depois.usuario[0].email_confirmado_em).toEqual(AGORA);
    expect(depois.tokens.filter((t) => t.usado_em === null && t.invalidado_em === null)).toHaveLength(0);
    expect(await verificarSenha(depois.usuario[0].senha_hash, NOVA)).toBe(true);
  });
});

describe('T-8: D-2 gestor com perfil de profissional inativo', () => {
  it('continua elegível: recebe o link, redefine e entra; a senha antiga é recusada', async () => {
    const s = await criarSalaoCompleto({ gestor: { comPerfil: true } });
    expect(s.gestor.profissionalId).not.toBeNull();
    await c.query('UPDATE profissional SET ativo = false WHERE id = $1', [s.gestor.profissionalId]);
    const token = await linkDe(s.gestor.email);
    expect(await redefinirSenha({ token, senha: NOVA }, { agora: AGORA, ...mudo })).toEqual({ ok: true, mensagem: MENSAGENS_RECUPERACAO.sucesso });
    expect(await entrar({ email: s.gestor.email, senha: SENHA_DE_TESTE }, { agora: AGORA, ...mudo })).toEqual({
      ok: false,
      motivo: 'recusado',
      mensagem: MENSAGENS_LOGIN.credenciais,
    });
    expect(await entrar({ email: s.gestor.email, senha: NOVA }, { agora: AGORA, ...mudo })).toMatchObject({ ok: true });
  });
});
