import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import type pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { chaveDeReenvio, confirmarEmail, novoTokenDeConfirmacao } from '@/server/auth/confirmacao-email';
import { JANELA_MS, LIMITE_FALHAS, MENSAGENS_LOGIN, chaveDeLogin, entrar, inicioDaJanela } from '@/server/auth/login';
import {
  ASSUNTO_RECUPERACAO,
  LIMITE_SOLICITACOES,
  MENSAGENS_RECUPERACAO,
  chaveDeRecuperacao,
  novoTokenDeRecuperacao,
  redefinirSenha,
  solicitarRecuperacao,
  verificarLinkDeRedefinicao,
} from '@/server/auth/recuperacao-senha';
import type { DepsRecuperacao } from '@/server/auth/recuperacao-senha';
import { gerarHashSenha, verificarSenha } from '@/server/auth/senha';
import { ErroEnvioEmail } from '@/server/integrations/email/port';
import { redefinirIntegracoes } from '@/server/integrations/registry';
import { NaoAutenticado } from '@/server/tenant/erros';
import { hashDoToken, resolverTenant } from '@/server/tenant/sessao';

import { criarSessao, criarSuperAdmin, entrarDeVerdade } from '../../support/auth';
import { SENHA_DE_TESTE, criarSalaoCompleto } from '../../support/factories';
import { urlDoWorker } from '../../support/db';
import { conectar, emailNovo } from '../../support/sql';

// D-012 T-3: serviço de recuperação de senha contra PostgreSQL real, com relógio injetado e o
// adaptador de e-mail simulado do registro (grava em email_log). CA-1..CA-4, CA-6..CA-10, CA-12..CA-15,
// CA-17 e CA-20; D-4 (a): com `agendar` capturando, nada é gravado antes de a tarefa rodar.

const HORA_MS = 60 * 60 * 1000;
const APP_URL = 'http://app.teste';
const T0 = new Date('2026-11-19T12:00:00.000Z');
const NOVA = 'nova-senha-9';
const UNIFORME = { ok: true, mensagem: MENSAGENS_RECUPERACAO.uniforme };
const LIMITE = { ok: false, motivo: 'limite', mensagem: MENSAGENS_RECUPERACAO.limite };
const recusado = (detalhe: string) => ({ ok: false, motivo: 'recusado', detalhe, mensagem: MENSAGENS_RECUPERACAO.recusado });

let c: pg.Client;

/** Todas as linhas de log do arquivo (CA-17) e os segredos que não podem aparecer nelas. */
const todasAsLinhas: string[] = [];
const segredos = new Set<string>([SENHA_DE_TESTE, NOVA]);

beforeAll(async () => {
  c = await conectar();
});
afterAll(async () => {
  await c.end();
});
afterEach(() => {
  vi.unstubAllEnvs();
  redefinirIntegracoes();
});

const em = (ms: number) => new Date(T0.getTime() + ms);

/** Dependências padrão com log capturado. */
function deps(agora: Date, extra: Partial<DepsRecuperacao> = {}) {
  const linhas: string[] = [];
  const d: DepsRecuperacao = {
    agora,
    appUrl: APP_URL,
    log: (l) => {
      linhas.push(l);
      todasAsLinhas.push(l);
    },
    ...extra,
  };
  return { linhas, d, json: () => linhas.map((l) => JSON.parse(l) as Record<string, unknown>) };
}

async function emails(destinatario: string) {
  const r = await c.query<{ assunto: string; corpo: string }>('SELECT assunto, corpo FROM email_log WHERE destinatario = $1 ORDER BY criado_em, id', [
    destinatario,
  ]);
  return r.rows;
}

function tokenDoCorpo(corpo: string): string {
  const m = new RegExp(`${APP_URL.replace(/\./g, '\\.')}/redefinir-senha\\?token=([A-Za-z0-9_-]{43})`).exec(corpo);
  if (!m) throw new Error('link não encontrado no corpo');
  segredos.add(m[1]);
  segredos.add(hashDoToken(m[1]));
  return m[1];
}

/** Pede a recuperação e devolve o token do último e-mail recebido. */
async function pedir(email: string, agora = T0): Promise<string> {
  expect(await solicitarRecuperacao({ email }, deps(agora).d)).toEqual(UNIFORME);
  const recebidos = await emails(email);
  return tokenDoCorpo(recebidos[recebidos.length - 1].corpo);
}

async function tokensDe(usuarioId: string, tipo = 'recuperacao_senha') {
  const r = await c.query<{ token_hash: string; expira_em: Date; usado_em: Date | null; invalidado_em: Date | null }>(
    'SELECT token_hash, expira_em, usado_em, invalidado_em FROM token WHERE usuario_id = $1 AND tipo = $2 ORDER BY criado_em, id',
    [usuarioId, tipo],
  );
  return r.rows;
}

async function usuario(id: string) {
  const r = await c.query<{ senha_hash: string; email_confirmado_em: Date | null }>('SELECT senha_hash, email_confirmado_em FROM usuario WHERE id = $1', [
    id,
  ]);
  segredos.add(r.rows[0].senha_hash);
  return r.rows[0];
}

async function n(sql: string, params: unknown[] = []): Promise<number> {
  return Number((await c.query<{ n: string }>(sql, params)).rows[0].n);
}

const totalTokens = () => n('SELECT count(*) AS n FROM token');
const totalEmails = () => n('SELECT count(*) AS n FROM email_log');
const sessoesAtivas = (usuarioId: string) => n('SELECT count(*) AS n FROM sessao WHERE usuario_id = $1 AND revogada_em IS NULL', [usuarioId]);

/** Gestor com e-mail conhecido (para os segredos do CA-17). */
async function salao(o: Parameters<typeof criarSalaoCompleto>[0] = {}) {
  const s = await criarSalaoCompleto(o);
  segredos.add(s.gestor.email);
  segredos.add(s.profissional.email);
  return s;
}

describe('CA-1: e-mail cadastrado recebe o link', () => {
  it('CA-1: gestor confirmado com e-mail em maiúsculas e espaços → 1 token (+1 h), 1 e-mail com o link; nada mais muda', async () => {
    const email = `ana-${randomUUID()}@exemplo.com`;
    const s = await salao({ gestor: { email } });
    await criarSessao(s.gestor.usuarioId);
    const antes = await usuario(s.gestor.usuarioId);
    const { d, json } = deps(T0);
    expect(await solicitarRecuperacao({ email: `  ${email.toUpperCase().replace('@EXEMPLO.COM', '@Exemplo.com')} ` }, d)).toEqual(UNIFORME);

    const tokens = await tokensDe(s.gestor.usuarioId);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ expira_em: em(HORA_MS), usado_em: null, invalidado_em: null });
    const recebidos = await emails(email);
    expect(recebidos).toHaveLength(1);
    expect(recebidos[0].assunto).toBe(ASSUNTO_RECUPERACAO);
    expect(recebidos[0].corpo).toContain(`${APP_URL}/redefinir-senha?token=`);
    const token = tokenDoCorpo(recebidos[0].corpo);
    expect(hashDoToken(token)).toBe(tokens[0].token_hash);
    expect(token).not.toBe(tokens[0].token_hash);
    expect(await usuario(s.gestor.usuarioId)).toEqual(antes);
    expect(await sessoesAtivas(s.gestor.usuarioId)).toBe(1);
    expect(json()).toEqual([{ evento: 'auth.recuperacao_senha', resultado: 'enviado', usuarioId: s.gestor.usuarioId, em: T0.toISOString() }]);
  });

  it('CA-1: o mesmo vale para um profissional ativo', async () => {
    const s = await salao();
    await pedir(s.profissional.email);
    expect(await tokensDe(s.profissional.usuarioId)).toHaveLength(1);
    expect((await emails(s.profissional.email))[0].assunto).toBe(ASSUNTO_RECUPERACAO);
  });
});

describe('CA-2 e CA-14: resposta uniforme sem efeito para quem não é elegível', () => {
  it('CA-2: inexistente, super admin, profissional inativo e profissional sem perfil → mesma resposta, nenhum token nem e-mail', async () => {
    const inativo = await salao({ profissional: { ativo: false } });
    const admin = await criarSuperAdmin();
    segredos.add(admin.email);
    const semPerfil = await salao();
    await c.query('UPDATE profissional SET usuario_id = NULL WHERE id = $1', [semPerfil.profissional.profissionalId]);

    const tokens = await totalTokens();
    const enviados = await totalEmails();
    const casos = [emailNovo(), admin.email, inativo.profissional.email, semPerfil.profissional.email];
    for (const email of casos) {
      const { d, json } = deps(T0);
      expect(await solicitarRecuperacao({ email }, d), email).toEqual(UNIFORME);
      expect(json()).toEqual([{ evento: 'auth.recuperacao_senha', resultado: 'ignorado', em: T0.toISOString() }]);
    }
    expect(await totalTokens()).toBe(tokens);
    expect(await totalEmails()).toBe(enviados);
  });

  it('CA-14: token de recuperação inserido para um super admin → recusado no GET e no POST; hash intacto', async () => {
    const admin = await criarSuperAdmin();
    const t = novoTokenDeRecuperacao(T0);
    await c.query(`INSERT INTO token (usuario_id, tipo, token_hash, expira_em) VALUES ($1, 'recuperacao_senha', $2, $3)`, [
      admin.usuarioId,
      t.tokenHash,
      t.expiraEm,
    ]);
    const antes = await usuario(admin.usuarioId);
    expect(await verificarLinkDeRedefinicao(t.token, deps(T0).d)).toEqual({ ok: false, motivo: 'inelegivel' });
    expect(await redefinirSenha({ token: t.token, senha: NOVA }, deps(T0).d)).toEqual(recusado('inelegivel'));
    expect(await usuario(admin.usuarioId)).toEqual(antes);
  });
});

describe('CA-3: redefinição com link válido', () => {
  it('CA-3: "Senha alterada"; nova senha entra, antiga não; 2 sessões anteriores revogadas; hash argon2id', async () => {
    const s = await salao();
    const agora = em(10 * 60_000);
    const sessao1 = await entrarDeVerdade(s.gestor.email, { agora: T0 });
    const sessao2 = await entrarDeVerdade(s.gestor.email, { agora: T0 });
    const token = await pedir(s.gestor.email);
    const { d, json } = deps(agora);

    expect(await redefinirSenha({ token, senha: NOVA }, d)).toEqual({ ok: true, mensagem: MENSAGENS_RECUPERACAO.sucesso });
    expect(json()).toEqual([
      { evento: 'auth.redefinicao_senha', resultado: 'ok', usuarioId: s.gestor.usuarioId, sessoesRevogadas: 2, em: agora.toISOString() },
    ]);
    expect((await tokensDe(s.gestor.usuarioId))[0].usado_em).toEqual(agora);
    for (const sessao of [sessao1, sessao2]) {
      await expect(resolverTenant(sessao.credencial, agora)).rejects.toBeInstanceOf(NaoAutenticado);
    }
    const r = await c.query<{ revogada_em: Date }>('SELECT revogada_em FROM sessao WHERE usuario_id = $1', [s.gestor.usuarioId]);
    expect(r.rows.map((x) => x.revogada_em)).toEqual([agora, agora]);
    const { senha_hash } = await usuario(s.gestor.usuarioId);
    expect(senha_hash.startsWith('$argon2id$')).toBe(true);
    expect(await verificarSenha(senha_hash, NOVA)).toBe(true);

    const depois = em(11 * 60_000);
    expect(await entrar({ email: s.gestor.email, senha: SENHA_DE_TESTE }, { agora: depois, log: () => {} })).toEqual({
      ok: false,
      motivo: 'recusado',
      mensagem: MENSAGENS_LOGIN.credenciais,
    });
    const novo = await entrar({ email: s.gestor.email, senha: NOVA }, { agora: depois, log: () => {} });
    expect(novo.ok).toBe(true);
  });
});

describe('CA-4: link usado, expirado ou substituído', () => {
  it('CA-4a: reabrir o link usado → recusa no GET e no POST, sem alterar hash nem sessões', async () => {
    const s = await salao();
    const token = await pedir(s.gestor.email);
    expect((await redefinirSenha({ token, senha: NOVA }, deps(em(60_000)).d)).ok).toBe(true);
    await criarSessao(s.gestor.usuarioId);
    const antes = await usuario(s.gestor.usuarioId);
    expect(await verificarLinkDeRedefinicao(token, deps(em(120_000)).d)).toEqual({ ok: false, motivo: 'ja_utilizado' });
    expect(await redefinirSenha({ token, senha: 'outra-senha-1' }, deps(em(120_000)).d)).toEqual(recusado('ja_utilizado'));
    expect(await usuario(s.gestor.usuarioId)).toEqual(antes);
    expect(await sessoesAtivas(s.gestor.usuarioId)).toBe(1);
  });

  it('CA-4b: emitido em T → T+1h e T+1h+1s recusados (GET e POST); T+1h−1s aceito', async () => {
    const s = await salao();
    const token = await pedir(s.gestor.email);
    const antes = await usuario(s.gestor.usuarioId);
    for (const delta of [0, 1000]) {
      const agora = em(HORA_MS + delta);
      expect(await verificarLinkDeRedefinicao(token, deps(agora).d)).toEqual({ ok: false, motivo: 'expirado_ou_substituido' });
      expect(await redefinirSenha({ token, senha: NOVA }, deps(agora).d)).toEqual(recusado('expirado_ou_substituido'));
    }
    expect(await usuario(s.gestor.usuarioId)).toEqual(antes);
    const quase = em(HORA_MS - 1000);
    expect(await verificarLinkDeRedefinicao(token, deps(quase).d)).toEqual({ ok: true });
    expect((await redefinirSenha({ token, senha: NOVA }, deps(quase).d)).ok).toBe(true);
  });

  it('CA-4c: segunda solicitação invalida o primeiro; o primeiro é recusado e o segundo funciona', async () => {
    const s = await salao();
    const primeiro = await pedir(s.gestor.email);
    const segundo = await pedir(s.gestor.email, em(60_000));
    const [a, b] = await tokensDe(s.gestor.usuarioId);
    expect(a.invalidado_em).toEqual(em(60_000));
    expect(b.invalidado_em).toBeNull();
    const agora = em(120_000);
    expect(await verificarLinkDeRedefinicao(primeiro, deps(agora).d)).toEqual({ ok: false, motivo: 'expirado_ou_substituido' });
    expect(await redefinirSenha({ token: primeiro, senha: NOVA }, deps(agora).d)).toEqual(recusado('expirado_ou_substituido'));
    expect(await verificarLinkDeRedefinicao(segundo, deps(agora).d)).toEqual({ ok: true });
    expect((await redefinirSenha({ token: segundo, senha: NOVA }, deps(agora).d)).ok).toBe(true);
  });
});

describe('CA-5 (serviço) e CA-6: verificação sem efeito e recusas', () => {
  it('CA-5: três verificações do link válido não gravam nada e continuam válidas', async () => {
    const s = await salao();
    const token = await pedir(s.gestor.email);
    const antes = await tokensDe(s.gestor.usuarioId);
    for (let i = 0; i < 3; i++) {
      const { d, json } = deps(em(60_000));
      expect(await verificarLinkDeRedefinicao(token, d)).toEqual({ ok: true });
      expect(json()).toEqual([{ evento: 'auth.redefinicao_senha_link', resultado: 'valido', em: em(60_000).toISOString() }]);
    }
    expect(await tokensDe(s.gestor.usuarioId)).toEqual(antes);
  });

  it('CA-6: formato válido sem registro e token de confirmação válido → invalido; nada muda', async () => {
    const s = await salao({ gestor: { emailConfirmado: false } });
    const conf = novoTokenDeConfirmacao(T0);
    await c.query(`INSERT INTO token (usuario_id, tipo, token_hash, expira_em) VALUES ($1, 'confirmacao_email', $2, $3)`, [
      s.gestor.usuarioId,
      conf.tokenHash,
      conf.expiraEm,
    ]);
    const antes = await usuario(s.gestor.usuarioId);
    for (const t of [novoTokenDeRecuperacao(T0).token, conf.token]) {
      expect(await verificarLinkDeRedefinicao(t, deps(T0).d)).toEqual({ ok: false, motivo: 'invalido' });
      expect(await redefinirSenha({ token: t, senha: NOVA }, deps(T0).d)).toEqual(recusado('invalido'));
    }
    expect(await usuario(s.gestor.usuarioId)).toEqual(antes);
    expect((await tokensDe(s.gestor.usuarioId, 'confirmacao_email'))[0]).toMatchObject({ usado_em: null, invalidado_em: null });
  });

  it('CA-6 (contraprova): token de recuperação aberto em /confirmar-email → "inválido", nada confirmado nem consumido', async () => {
    const s = await salao({ gestor: { emailConfirmado: false } });
    const token = await pedir(s.gestor.email);
    expect(await confirmarEmail(token, { agora: em(60_000), log: () => {} })).toBe('invalido');
    expect((await usuario(s.gestor.usuarioId)).email_confirmado_em).toBeNull();
    expect((await tokensDe(s.gestor.usuarioId))[0].usado_em).toBeNull();
  });
});

describe('CA-7: validação da nova senha', () => {
  it('CA-7: 7, 1025, ausente e de tipo errado → erro do campo, sem hash; token continua válido; 8 espaços aceitos', async () => {
    const s = await salao();
    const token = await pedir(s.gestor.email);
    let hashes = 0;
    const contar = async (senha: string) => {
      hashes += 1;
      return gerarHashSenha(senha);
    };
    const casos: [unknown, string][] = [
      ['1234567', MENSAGENS_RECUPERACAO.senhaCurta],
      ['x'.repeat(1025), MENSAGENS_RECUPERACAO.senhaLonga],
      [undefined, MENSAGENS_RECUPERACAO.senhaCurta],
      [42, MENSAGENS_RECUPERACAO.senhaCurta],
    ];
    for (const [senha, erro] of casos) {
      const { d, json } = deps(em(60_000), { hashSenha: contar });
      expect(await redefinirSenha({ token, senha }, d)).toEqual({ ok: false, motivo: 'validacao', erros: { senha: erro } });
      expect(json()).toEqual([{ evento: 'auth.redefinicao_senha', resultado: 'validacao', em: em(60_000).toISOString() }]);
    }
    expect(hashes).toBe(0);
    expect(await verificarLinkDeRedefinicao(token, deps(em(60_000)).d)).toEqual({ ok: true });

    expect((await redefinirSenha({ token, senha: '        ' }, deps(em(60_000), { hashSenha: contar }).d)).ok).toBe(true);
    expect(hashes).toBe(1);
    expect(await verificarSenha((await usuario(s.gestor.usuarioId)).senha_hash, '        ')).toBe(true);
  });

  it('recusa não calcula hash (token inexistente)', async () => {
    let hashes = 0;
    const r = await redefinirSenha(
      { token: novoTokenDeRecuperacao(T0).token, senha: NOVA },
      deps(T0, {
        hashSenha: async () => {
          hashes += 1;
          return 'x';
        },
      }).d,
    );
    expect(r).toEqual(recusado('invalido'));
    expect(hashes).toBe(0);
  });
});

describe('CA-8: gestor não confirmado', () => {
  it('CA-8: redefinir pelo link confirma o e-mail, invalida a confirmação pendente e o login entra no /painel', async () => {
    const s = await salao({ gestor: { emailConfirmado: false } });
    const conf = novoTokenDeConfirmacao(T0);
    await c.query(`INSERT INTO token (usuario_id, tipo, token_hash, expira_em) VALUES ($1, 'confirmacao_email', $2, $3)`, [
      s.gestor.usuarioId,
      conf.tokenHash,
      conf.expiraEm,
    ]);
    const token = await pedir(s.gestor.email);
    const agora = em(60_000);
    expect((await redefinirSenha({ token, senha: NOVA }, deps(agora).d)).ok).toBe(true);
    expect((await usuario(s.gestor.usuarioId)).email_confirmado_em).toEqual(agora);
    expect((await tokensDe(s.gestor.usuarioId, 'confirmacao_email'))[0].invalidado_em).toEqual(agora);
    const r = await entrar({ email: s.gestor.email, senha: NOVA }, { agora, log: () => {} });
    expect(r).toMatchObject({ ok: true, destino: '/painel' });
  });
});

describe('CA-9: profissional desativado depois do pedido', () => {
  it('CA-9: abrir e enviar são recusados (inelegivel); hash intacto. Contraprova: ativo redefine e entra', async () => {
    const s = await salao();
    const token = await pedir(s.profissional.email);
    await c.query('UPDATE profissional SET ativo = false WHERE id = $1', [s.profissional.profissionalId]);
    const antes = await usuario(s.profissional.usuarioId);
    expect(await verificarLinkDeRedefinicao(token, deps(em(60_000)).d)).toEqual({ ok: false, motivo: 'inelegivel' });
    expect(await redefinirSenha({ token, senha: NOVA }, deps(em(60_000)).d)).toEqual(recusado('inelegivel'));
    expect(await usuario(s.profissional.usuarioId)).toEqual(antes);

    const outro = await salao();
    const t2 = await pedir(outro.profissional.email);
    expect((await redefinirSenha({ token: t2, senha: NOVA }, deps(em(60_000)).d)).ok).toBe(true);
    expect((await entrar({ email: outro.profissional.email, senha: NOVA }, { agora: em(60_000), log: () => {} })).ok).toBe(true);
  });
});

describe('CA-10: limite de 3 solicitações por e-mail em 15 min', () => {
  const contador = async (chave: string, agora: Date) =>
    (await c.query<{ contador: number }>('SELECT contador FROM rate_limit_janela WHERE chave = $1 AND janela_inicio = $2', [chave, inicioDaJanela(agora)]))
      .rows[0]?.contador ?? null;

  it('CA-10: existente e inexistente: 3 uniformes, a 4ª limite (sem token nem e-mail); janela seguinte volta; chaves independentes', async () => {
    const s = await salao();
    const inexistente = emailNovo();
    for (const email of [s.gestor.email, inexistente]) {
      const respostas = [];
      for (let i = 0; i < LIMITE_SOLICITACOES + 1; i++) {
        const { d } = deps(em(i * 1000));
        respostas.push(await solicitarRecuperacao({ email }, d));
      }
      expect(respostas, email).toEqual([UNIFORME, UNIFORME, UNIFORME, LIMITE]);
    }
    expect(await tokensDe(s.gestor.usuarioId)).toHaveLength(3);
    expect(await emails(s.gestor.email)).toHaveLength(3);
    expect(await emails(inexistente)).toHaveLength(0);

    const limite = deps(em(5000));
    expect(await solicitarRecuperacao({ email: s.gestor.email }, limite.d)).toEqual(LIMITE);
    expect(limite.json()).toEqual([{ evento: 'auth.recuperacao_senha', resultado: 'limite', em: em(5000).toISOString() }]);

    const seguinte = new Date(inicioDaJanela(T0).getTime() + JANELA_MS);
    expect(await solicitarRecuperacao({ email: s.gestor.email }, deps(seguinte).d)).toEqual(UNIFORME);
    expect(await emails(s.gestor.email)).toHaveLength(4);

    expect(await contador(chaveDeRecuperacao(s.gestor.email), T0)).toBe(5);
    expect(await contador(chaveDeLogin(s.gestor.email), T0)).toBeNull();
    expect(await contador(chaveDeReenvio(s.gestor.email), T0)).toBeNull();
  });

  it('CA-10: e-mail inválido não conta nem consulta o banco de usuários', async () => {
    const email = emailNovo();
    for (const invalido of ['', 'sem-arroba', `${email}\nBcc: x@y.z`, 'a'.repeat(10 * 1024), undefined, 42]) {
      const { d, json } = deps(T0);
      expect(await solicitarRecuperacao({ email: invalido }, d)).toEqual({
        ok: false,
        motivo: 'validacao',
        erros: { email: MENSAGENS_RECUPERACAO.emailInvalido },
      });
      expect(json()).toEqual([{ evento: 'auth.recuperacao_senha', resultado: 'validacao', em: T0.toISOString() }]);
    }
    expect(await contador(chaveDeRecuperacao(email), T0)).toBeNull();
  });
});

describe('CA-12: falha no envio', () => {
  it('CA-12: adaptador que lança ErroEnvioEmail → resposta uniforme, token gravado, log envio_falhou; novo pedido normal invalida e envia', async () => {
    const s = await salao();
    const falha = { enviar: async () => Promise.reject(new ErroEnvioEmail('conexao', true)) };
    const { d, json } = deps(T0, { email: falha });
    expect(await solicitarRecuperacao({ email: s.gestor.email }, d)).toEqual(UNIFORME);
    expect(json()).toEqual([{ evento: 'auth.recuperacao_senha', resultado: 'envio_falhou', usuarioId: s.gestor.usuarioId, em: T0.toISOString() }]);
    expect(await tokensDe(s.gestor.usuarioId)).toHaveLength(1);
    expect(await emails(s.gestor.email)).toHaveLength(0);

    const token = await pedir(s.gestor.email, em(60_000));
    const [a, b] = await tokensDe(s.gestor.usuarioId);
    expect(a.invalidado_em).toEqual(em(60_000));
    expect(b.token_hash).toBe(hashDoToken(token));
  });

  it('CA-12: EMAIL_ADAPTER=real sem SMTP e APP_URL inválida → uniforme e envio_falhou', async () => {
    const s = await salao();
    vi.stubEnv('EMAIL_ADAPTER', 'real');
    redefinirIntegracoes();
    const semSmtp = deps(T0, { appUrl: undefined });
    expect(await solicitarRecuperacao({ email: s.gestor.email }, semSmtp.d)).toEqual(UNIFORME);
    expect(semSmtp.json()).toMatchObject([{ resultado: 'envio_falhou', usuarioId: s.gestor.usuarioId }]);
    vi.unstubAllEnvs();
    redefinirIntegracoes();

    const urlRuim = deps(em(1000), { appUrl: 'nao é url' });
    expect(await solicitarRecuperacao({ email: s.gestor.email }, urlRuim.d)).toEqual(UNIFORME);
    expect(urlRuim.json()).toMatchObject([{ resultado: 'envio_falhou' }]);
    expect(await tokensDe(s.gestor.usuarioId)).toHaveLength(2);
    expect(await emails(s.gestor.email)).toHaveLength(0);
  });

  it('R-4: erro de banco dentro da tarefa (token_hash repetido) → log falha, sem exceção para quem chamou', async () => {
    const s = await salao();
    const fixo = novoTokenDeRecuperacao(T0).token;
    expect(await solicitarRecuperacao({ email: s.gestor.email }, deps(T0, { gerarToken: () => fixo }).d)).toEqual(UNIFORME);
    const segundo = deps(em(1000), { gerarToken: () => fixo });
    expect(await solicitarRecuperacao({ email: s.gestor.email }, segundo.d)).toEqual(UNIFORME);
    expect(segundo.json()).toEqual([{ evento: 'auth.recuperacao_senha', resultado: 'falha', em: em(1000).toISOString() }]);
    // A transação foi desfeita: o primeiro token continua válido e único.
    expect(await tokensDe(s.gestor.usuarioId)).toMatchObject([{ invalidado_em: null }]);
  });
});

describe('corrida busca × emissão', () => {
  it('profissional desativado entre a busca e a trava → nada gravado nem enviado; log ignorado com usuarioId', async () => {
    const s = await salao();
    const desativar = `
      const { Client } = require('pg');
      (async () => {
        const c = new Client({ connectionString: process.env.URL_BANCO });
        await c.connect();
        await c.query('UPDATE profissional SET ativo = false WHERE id = $1', [process.env.PROFISSIONAL]);
        await c.end();
      })().catch((e) => { console.error(e); process.exit(1); });`;
    // gerarToken roda depois da busca e antes da transação de emissão: o gancho desativa o perfil
    // de forma SÍNCRONA (processo filho), então a trava da emissão já vê ativo = false.
    const gerarToken = () => {
      execFileSync(process.execPath, ['-e', desativar], {
        env: { ...process.env, URL_BANCO: urlDoWorker(), PROFISSIONAL: s.profissional.profissionalId },
      });
      return novoTokenDeRecuperacao(T0).token;
    };
    const { d, json } = deps(T0, { gerarToken });
    expect(await solicitarRecuperacao({ email: s.profissional.email }, d)).toEqual(UNIFORME);
    expect(json()).toEqual([{ evento: 'auth.recuperacao_senha', resultado: 'ignorado', usuarioId: s.profissional.usuarioId, em: T0.toISOString() }]);
    expect(await tokensDe(s.profissional.usuarioId)).toEqual([]);
    expect(await emails(s.profissional.email)).toEqual([]);
    // O gancho sobe um processo filho do node (DEF-CI-1 da D-016): timeout explícito e folgado.
  }, 30_000);
});

describe('D-4 (a): adiamento da tarefa', () => {
  it('com agendar capturando: a resposta volta sem token nem e-mail; ao executar a tarefa, aparecem', async () => {
    const s = await salao();
    const fila: (() => Promise<void>)[] = [];
    const { d } = deps(T0, { agendar: (t) => void fila.push(t) });
    expect(await solicitarRecuperacao({ email: s.gestor.email }, d)).toEqual(UNIFORME);
    expect(fila).toHaveLength(1);
    expect(await tokensDe(s.gestor.usuarioId)).toHaveLength(0);
    expect(await emails(s.gestor.email)).toHaveLength(0);
    await fila[0]();
    expect(await tokensDe(s.gestor.usuarioId)).toHaveLength(1);
    expect(await emails(s.gestor.email)).toHaveLength(1);
  });

  it('inexistente também agenda exatamente uma tarefa (caminho síncrono idêntico)', async () => {
    const fila: (() => Promise<void>)[] = [];
    expect(await solicitarRecuperacao({ email: emailNovo() }, deps(T0, { agendar: (t) => void fila.push(t) }).d)).toEqual(UNIFORME);
    expect(fila).toHaveLength(1);
    await fila[0]();
  });
});

describe('CA-13: isolamento entre salões', () => {
  it('CA-13: gestor de A redefine; só as sessões dele caem; B e o profissional de A intactos; token de B não toca A', async () => {
    const a = await salao();
    const b = await salao();
    await criarSessao(a.gestor.usuarioId);
    const profA = await criarSessao(a.profissional.usuarioId);
    const gestorB = await criarSessao(b.gestor.usuarioId);
    const hashes = { profA: (await usuario(a.profissional.usuarioId)).senha_hash, b: (await usuario(b.gestor.usuarioId)).senha_hash };
    const tokenA = await pedir(a.gestor.email);
    const tokenB = await pedir(b.gestor.email);

    expect((await redefinirSenha({ token: tokenA, senha: NOVA }, deps(em(60_000)).d)).ok).toBe(true);
    expect(await sessoesAtivas(a.gestor.usuarioId)).toBe(0);
    expect((await resolverTenant(profA.credencial, em(60_000))).usuarioId).toBe(a.profissional.usuarioId);
    expect((await resolverTenant(gestorB.credencial, em(60_000))).usuarioId).toBe(b.gestor.usuarioId);
    expect((await usuario(a.profissional.usuarioId)).senha_hash).toBe(hashes.profA);
    expect((await usuario(b.gestor.usuarioId)).senha_hash).toBe(hashes.b);
    expect(await verificarLinkDeRedefinicao(tokenB, deps(em(60_000)).d)).toEqual({ ok: true });

    const hashA = (await usuario(a.gestor.usuarioId)).senha_hash;
    expect((await redefinirSenha({ token: tokenB, senha: 'senha-de-b-1' }, deps(em(120_000)).d)).ok).toBe(true);
    expect((await usuario(a.gestor.usuarioId)).senha_hash).toBe(hashA);
    expect(await sessoesAtivas(a.profissional.usuarioId)).toBe(1);
  });
});

describe('CA-15: redefinir libera o login bloqueado pelo limite', () => {
  it('CA-15: 10 falhas → "Muitas tentativas"; após redefinir, a nova senha entra na mesma janela', async () => {
    const s = await salao();
    const agora = em(60_000);
    for (let i = 0; i < LIMITE_FALHAS; i++) {
      await entrar({ email: s.gestor.email, senha: 'errada-errada' }, { agora, log: () => {}, verificarSenha: async () => false });
    }
    expect(await entrar({ email: s.gestor.email, senha: SENHA_DE_TESTE }, { agora, log: () => {} })).toEqual({
      ok: false,
      motivo: 'recusado',
      mensagem: MENSAGENS_LOGIN.limite,
    });
    const token = await pedir(s.gestor.email, agora);
    expect((await redefinirSenha({ token, senha: NOVA }, deps(agora).d)).ok).toBe(true);
    expect((await entrar({ email: s.gestor.email, senha: NOVA }, { agora, log: () => {} })).ok).toBe(true);
  });
});

describe('CA-20: salão suspenso', () => {
  it('CA-20: gestor de salão com suspenso_manual_em recupera e redefine como no CA-1/CA-3', async () => {
    const s = await salao();
    await c.query('UPDATE salao SET suspenso_manual_em = $1 WHERE id = $2', [T0, s.salaoId]);
    const token = await pedir(s.gestor.email);
    expect(await verificarLinkDeRedefinicao(token, deps(em(60_000)).d)).toEqual({ ok: true });
    expect((await redefinirSenha({ token, senha: NOVA }, deps(em(60_000)).d)).ok).toBe(true);
    expect(await verificarSenha((await usuario(s.gestor.usuarioId)).senha_hash, NOVA)).toBe(true);
  });
});

describe('falha de banco na redefinição', () => {
  it('erro do PostgreSQL na transação (NUL no hash) → "falha", nada muda; o token continua utilizável', async () => {
    const s = await salao();
    await criarSessao(s.gestor.usuarioId);
    const token = await pedir(s.gestor.email);
    const antes = await usuario(s.gestor.usuarioId);
    const { d, json } = deps(em(60_000), { hashSenha: async () => 'com\u0000nul' });
    expect(await redefinirSenha({ token, senha: NOVA }, d)).toEqual({ ok: false, motivo: 'falha', mensagem: MENSAGENS_RECUPERACAO.falha });
    expect(json()).toEqual([{ evento: 'auth.redefinicao_senha', resultado: 'falha', em: em(60_000).toISOString() }]);
    expect(await usuario(s.gestor.usuarioId)).toEqual(antes);
    expect(await sessoesAtivas(s.gestor.usuarioId)).toBe(1);
    expect(await verificarLinkDeRedefinicao(token, deps(em(60_000)).d)).toEqual({ ok: true });
  });
});

describe('CA-17: logs sem dados pessoais nem segredos', () => {
  it('CA-17: nenhuma linha de log do arquivo contém senha, token, token_hash, senha_hash ou e-mail', () => {
    expect(todasAsLinhas.length).toBeGreaterThan(40);
    const eventos = new Set(todasAsLinhas.map((l) => (JSON.parse(l) as { evento: string }).evento));
    expect([...eventos].sort()).toEqual(['auth.recuperacao_senha', 'auth.redefinicao_senha', 'auth.redefinicao_senha_link']);
    for (const linha of todasAsLinhas) {
      for (const segredo of segredos) {
        expect(linha.includes(segredo), `log contém um segredo: ${linha}`).toBe(false);
      }
      expect(linha).not.toMatch(/@|argon2/);
    }
  });
});
