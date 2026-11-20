import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { MENSAGENS_CADASTRO, cadastrar } from '@/server/auth/cadastro';
import type { CampoCadastro, DepsCadastro } from '@/server/auth/cadastro';
import { MENSAGENS_CONFIRMACAO, confirmarEmail, reenviarConfirmacao } from '@/server/auth/confirmacao-email';
import { MENSAGENS_LOGIN, entrar } from '@/server/auth/login';
import { verificarSenha } from '@/server/auth/senha';
import { ErroEnvioEmail } from '@/server/integrations/email/port';
import { hashDoToken, resolverTenant } from '@/server/tenant/sessao';

import { criarSalaoCompleto } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { conectar, emailNovo } from '../../support/sql';

// D-011 T-4: serviço de cadastro contra PostgreSQL real (arquivo da issue). CA-1..CA-6, CA-9, CA-10
// (efeitos), CA-13, CA-17 e CA-19. Relógio injetado; e-mail pelo adaptador do registro (simulado,
// grava em email_log). Literais de slug deste arquivo: `studio-bela`, `espaco-nobre`.

const HORA_MS = 60 * 60 * 1000;
const APP_URL = 'http://app.teste';
const T0 = new Date('2026-11-19T12:00:00.000Z');
const SENHA = 'senha-forte-1';

let c: pg.Client;
let s: SalaoCompleto;

beforeAll(async () => {
  c = await conectar();
  s = await criarSalaoCompleto();
});
afterAll(async () => {
  await c.end();
});

function deps(agora: Date = T0, extra: Partial<DepsCadastro> = {}) {
  const linhas: string[] = [];
  return { linhas, d: { agora, appUrl: APP_URL, log: (l: string) => linhas.push(l), ...extra } satisfies DepsCadastro };
}

function entrada(parcial: Partial<Record<CampoCadastro, unknown>> = {}): Record<CampoCadastro, unknown> {
  return { nome: 'Ana Souza', email: emailNovo(), senha: SENHA, nomeSalao: 'Salão Qualquer', ...parcial };
}

async function n(sql: string, params: unknown[] = []): Promise<number> {
  return Number((await c.query<{ n: string }>(sql, params)).rows[0].n);
}

/** Contagem das 5 tabelas do CA-3, em sequência (um cliente pg não aceita consultas paralelas). */
async function contagens(): Promise<number[]> {
  const r: number[] = [];
  for (const t of ['salao', 'salao_slug', 'usuario', 'token', 'email_log']) r.push(await n(`SELECT count(*) AS n FROM ${t}`));
  return r;
}

async function emails(destinatario: string) {
  const r = await c.query<{ assunto: string; corpo: string }>(
    'SELECT assunto, corpo FROM email_log WHERE destinatario = $1 ORDER BY criado_em, id',
    [destinatario],
  );
  return r.rows;
}

function tokenDoCorpo(corpo: string): string {
  const m = /http:\/\/app\.teste\/confirmar-email\?token=([A-Za-z0-9_-]{43})/.exec(corpo);
  if (!m) throw new Error('link não encontrado');
  return m[1];
}

async function usuarioPorEmail(email: string) {
  const r = await c.query<{
    id: string;
    salao_id: string;
    papel: string;
    nome: string;
    senha_hash: string;
    email_confirmado_em: Date | null;
  }>('SELECT id, salao_id, papel, nome, senha_hash, email_confirmado_em FROM usuario WHERE email = $1', [email]);
  return r.rows[0];
}

async function slugDe(salaoId: string): Promise<string> {
  const r = await c.query<{ slug: string }>('SELECT slug FROM salao_slug WHERE salao_id = $1 AND atual', [salaoId]);
  return r.rows[0].slug;
}

describe('CA-1: cadastro válido', () => {
  it('CA-1: salão com defaults e slug, gestor não confirmado com argon2id, token de 24 h e e-mail com o link', async () => {
    const { d } = deps();
    const r = await cadastrar({ nome: 'Ana Souza', email: 'ana@exemplo.com', senha: SENHA, nomeSalao: 'Studio Bela' }, d);
    expect(r).toEqual({ ok: true, email: 'ana@exemplo.com', envio: 'enviado' });

    const u = await usuarioPorEmail('ana@exemplo.com');
    expect([u.papel, u.nome, u.email_confirmado_em]).toEqual(['gestor', 'Ana Souza', null]);
    expect(u.senha_hash).toMatch(/^\$argon2id\$/);
    expect(await verificarSenha(u.senha_hash, SENHA)).toBe(true);

    const salao = await c.query(
      'SELECT nome, fuso, grade_min, antecedencia_min, janela_dias, intervalo_min, suspenso_manual_em FROM salao WHERE id = $1',
      [u.salao_id],
    );
    expect(salao.rows).toEqual([
      {
        nome: 'Studio Bela',
        fuso: 'America/Sao_Paulo',
        grade_min: 15,
        antecedencia_min: 120,
        janela_dias: 60,
        intervalo_min: 0,
        suspenso_manual_em: null,
      },
    ]);
    const slugs = await c.query('SELECT slug, atual FROM salao_slug WHERE salao_id = $1', [u.salao_id]);
    expect(slugs.rows).toEqual([{ slug: 'studio-bela', atual: true }]);

    const tokens = await c.query<{ token_hash: string; tipo: string; expira_em: Date; usado_em: Date | null; invalidado_em: Date | null }>(
      'SELECT token_hash, tipo, expira_em, usado_em, invalidado_em FROM token WHERE usuario_id = $1',
      [u.id],
    );
    expect(tokens.rows).toHaveLength(1);
    const [t] = tokens.rows;
    expect([t.tipo, t.expira_em, t.usado_em, t.invalidado_em]).toEqual([
      'confirmacao_email',
      new Date(T0.getTime() + 24 * HORA_MS),
      null,
      null,
    ]);

    for (const tabela of ['assinatura', 'profissional']) {
      expect(await n(`SELECT count(*) AS n FROM ${tabela} WHERE salao_id = $1`, [u.salao_id]), tabela).toBe(0);
    }
    expect(await n('SELECT count(*) AS n FROM sessao WHERE usuario_id = $1', [u.id])).toBe(0);

    const recebidos = await emails('ana@exemplo.com');
    expect(recebidos).toHaveLength(1);
    expect(recebidos[0].assunto).toBe('Confirme seu e-mail no Agenda Beleza');
    expect(recebidos[0].corpo).toContain(`${APP_URL}/confirmar-email?token=`);
    expect(recebidos[0].corpo).toContain('Ana Souza');
    expect(recebidos[0].corpo).toContain('Studio Bela');
    expect(recebidos[0].corpo).toContain('24 horas');
    const token = tokenDoCorpo(recebidos[0].corpo);
    expect(t.token_hash).not.toBe(token);
    expect(hashDoToken(token)).toBe(t.token_hash);
  });
});

describe('CA-2: slug em colisão', () => {
  it('CA-2: segundo e terceiro "Studio Bela" → studio-bela-2 e studio-bela-3', async () => {
    const slugs: string[] = [];
    for (let i = 0; i < 2; i++) {
      const e = entrada({ nomeSalao: 'Studio Bela' });
      expect(await cadastrar(e, deps().d)).toMatchObject({ ok: true });
      slugs.push(await slugDe((await usuarioPorEmail(e.email as string)).salao_id));
    }
    expect(slugs).toEqual(['studio-bela-2', 'studio-bela-3']);
  });

  it('CA-2: base existente só como slug histórico de outro salão → -2', async () => {
    await c.query('INSERT INTO salao_slug (slug, salao_id, atual) VALUES ($1, $2, false)', ['espaco-nobre', s.salaoId]);
    const e = entrada({ nomeSalao: 'Espaço Nobre' });
    expect(await cadastrar(e, deps().d)).toMatchObject({ ok: true });
    expect(await slugDe((await usuarioPorEmail(e.email as string)).salao_id)).toBe('espaco-nobre-2');
  });
});

describe('CA-3: e-mail já cadastrado', () => {
  it('CA-3: gestor confirmado, gestor não confirmado e profissional → recusa no campo e-mail, nada gravado', async () => {
    const naoConfirmado = await criarSalaoCompleto({ gestor: { emailConfirmado: false } });
    const donos = [s.gestor.email, naoConfirmado.gestor.email, s.profissional.email];
    const antes = await contagens();
    const hashSenha = vi.fn(async () => 'h');
    for (const email of donos) {
      const variante = `${email.toUpperCase()} `;
      const r = await cadastrar(entrada({ email: variante, nomeSalao: 'Outro Salão' }), deps(T0, { hashSenha }).d);
      expect(r, email).toEqual({ ok: false, motivo: 'email_existente', erros: { email: MENSAGENS_CADASTRO.emailExistente } });
    }
    expect(hashSenha).not.toHaveBeenCalled();
    expect(await contagens()).toEqual(antes);
  });
});

describe('CA-4 e CA-5: confirmação pelo link recebido no cadastro', () => {
  it('CA-4: abrir confirma (relógio injetado); reabrir → já utilizado, sem mudar nada e sem e-mail', async () => {
    const e = entrada();
    await cadastrar(e, deps().d);
    const [m] = await emails(e.email as string);
    const token = tokenDoCorpo(m.corpo);
    const agora = new Date(T0.getTime() + HORA_MS);
    expect(await confirmarEmail(token, { agora, log: () => {} })).toBe('confirmado');
    const u = await usuarioPorEmail(e.email as string);
    expect(u.email_confirmado_em).toEqual(agora);
    const t = await c.query('SELECT usado_em FROM token WHERE token_hash = $1', [hashDoToken(token)]);
    expect(t.rows).toEqual([{ usado_em: agora }]);

    const total = await n('SELECT count(*) AS n FROM email_log');
    expect(await confirmarEmail(token, { agora: new Date(agora.getTime() + HORA_MS), log: () => {} })).toBe('ja_utilizado');
    expect((await usuarioPorEmail(e.email as string)).email_confirmado_em).toEqual(agora);
    expect(await n('SELECT count(*) AS n FROM email_log')).toBe(total);
  });

  it('CA-5: o link do cadastro aberto em T+24h é recusado; o reenvio pelo token gera um link que confirma', async () => {
    const e = entrada();
    await cadastrar(e, deps().d);
    const token = tokenDoCorpo((await emails(e.email as string))[0].corpo);
    const vencido = new Date(T0.getTime() + 24 * HORA_MS);
    expect(await confirmarEmail(token, { agora: vencido, log: () => {} })).toBe('expirado_ou_substituido');
    expect(await reenviarConfirmacao({ token }, { agora: vencido, appUrl: APP_URL, log: () => {} })).toEqual({
      ok: true,
      mensagem: MENSAGENS_CONFIRMACAO.reenvioUniforme,
    });
    const recebidos = await emails(e.email as string);
    expect(recebidos).toHaveLength(2);
    expect(await confirmarEmail(tokenDoCorpo(recebidos[1].corpo), { agora: vencido, log: () => {} })).toBe('confirmado');
  });
});

describe('CA-6: gestor não confirmado tenta entrar', () => {
  it('CA-6: senha certa → negado com reenvio; reenviar grava token e e-mail; senha errada → genérica; após confirmar, entra em /painel', async () => {
    const e = entrada();
    await cadastrar(e, deps().d);
    const email = e.email as string;
    const u = await usuarioPorEmail(email);
    const silencioso = { log: () => {} };

    const r = await entrar({ email, senha: SENHA }, silencioso);
    expect(r).toEqual({ ok: false, motivo: 'recusado', mensagem: MENSAGENS_LOGIN.naoConfirmado, reenvioDisponivel: true });
    expect(await n('SELECT count(*) AS n FROM sessao WHERE usuario_id = $1', [u.id])).toBe(0);

    const errada = await entrar({ email, senha: 'errada!!' }, silencioso);
    const inexistente = await entrar({ email: emailNovo(), senha: 'errada!!' }, silencioso);
    expect(errada).toEqual({ ok: false, motivo: 'recusado', mensagem: MENSAGENS_LOGIN.credenciais });
    expect(errada).toEqual(inexistente);

    const agora = new Date(T0.getTime() + HORA_MS);
    expect(await reenviarConfirmacao({ email }, { agora, appUrl: APP_URL, log: () => {} })).toMatchObject({ ok: true });
    expect(await n(`SELECT count(*) AS n FROM token WHERE usuario_id = $1 AND tipo = 'confirmacao_email'`, [u.id])).toBe(2);
    const recebidos = await emails(email);
    expect(recebidos).toHaveLength(2);

    expect(await confirmarEmail(tokenDoCorpo(recebidos[1].corpo), { agora, log: () => {} })).toBe('confirmado');
    const ok = await entrar({ email, senha: SENHA }, silencioso);
    expect(ok).toMatchObject({ ok: true, destino: '/painel' });
    if (!ok.ok) return;
    const ctx = await resolverTenant({ token: ok.token });
    expect([ctx.papel, ctx.salaoId]).toEqual(['gestor', u.salao_id]);
  });
});

describe('CA-9: e-mail com maiúsculas', () => {
  it('CA-9: "  Ana.Souza@Exemplo.COM " grava minúsculo, envia para o minúsculo e o login com outra caixa funciona', async () => {
    const local = `ana.souza.${Date.now()}`;
    const r = await cadastrar(entrada({ email: `  ${local.replace('a', 'A')}@Exemplo.COM ` }), deps().d);
    const email = `${local}@exemplo.com`;
    expect(r).toEqual({ ok: true, email, envio: 'enviado' });
    expect(await usuarioPorEmail(email)).toBeDefined();
    const [m] = await emails(email);
    expect(await confirmarEmail(tokenDoCorpo(m.corpo), { agora: T0, log: () => {} })).toBe('confirmado');
    expect(await entrar({ email: email.toUpperCase(), senha: SENHA }, { log: () => {} })).toMatchObject({ ok: true });
  });
});

describe('CA-10: entrada inválida sem efeitos', () => {
  it('CA-10: cada entrada inválida → mensagem do campo, nada gravado, hash e e-mail não chamados', async () => {
    const antes = await contagens();
    const hashSenha = vi.fn(async () => 'h');
    const enviar = vi.fn(async () => ({ provedorId: '1' }));
    const invalidas: Partial<Record<CampoCadastro, unknown>>[] = [
      { nome: '' },
      { nome: 'A' },
      { nome: 'a'.repeat(101) },
      { email: 'sem-arroba' },
      { email: `${'a'.repeat(243)}@exemplo.com` },
      { senha: '1234567' },
      { senha: 'x'.repeat(1025) },
      { nomeSalao: '' },
      { nomeSalao: '   ' },
      { nomeSalao: 's'.repeat(81) },
      { nome: undefined, email: 3, senha: {}, nomeSalao: null },
    ];
    for (const inv of invalidas) {
      const r = await cadastrar(entrada(inv), deps(T0, { hashSenha, email: { enviar } }).d);
      expect(r.ok).toBe(false);
      expect(r).toMatchObject({ motivo: 'validacao' });
    }
    expect(hashSenha).not.toHaveBeenCalled();
    expect(enviar).not.toHaveBeenCalled();
    expect(await contagens()).toEqual(antes);
  });

  it('CA-10 (contraprova): senha de 8 espaços é aceita e entra depois de confirmar', async () => {
    const e = entrada({ senha: '        ' });
    expect(await cadastrar(e, deps().d)).toMatchObject({ ok: true });
    const [m] = await emails(e.email as string);
    await confirmarEmail(tokenDoCorpo(m.corpo), { agora: T0, log: () => {} });
    expect(await entrar({ email: e.email, senha: '        ' }, { log: () => {} })).toMatchObject({ ok: true });
  });
});

describe('CA-13: falha antes do commit desfaz tudo', () => {
  it('CA-13: token_hash já existente (gerador fixo) → falha genérica, nada gravado, nenhum e-mail', async () => {
    const fixo = 'F'.repeat(43);
    expect(await cadastrar(entrada(), deps(T0, { gerarToken: () => fixo }).d)).toMatchObject({ ok: true });
    const antes = await contagens();
    const e = entrada({ nomeSalao: 'Salão que não fica' });
    const { linhas, d } = deps(T0, { gerarToken: () => fixo });
    expect(await cadastrar(e, d)).toEqual({ ok: false, motivo: 'falha', mensagem: MENSAGENS_CADASTRO.falha });
    expect(await contagens()).toEqual(antes);
    expect(await usuarioPorEmail(e.email as string)).toBeUndefined();
    expect(await n(`SELECT count(*) AS n FROM salao WHERE nome = 'Salão que não fica'`)).toBe(0);
    expect(await emails(e.email as string)).toEqual([]);
    const log = JSON.parse(linhas[0]) as Record<string, unknown>;
    expect([log.evento, log.resultado]).toEqual(['auth.cadastro', 'falha']);
    expect(linhas.join('\n')).not.toContain(e.email as string);
  });

  it('RN-17: corrida perdida no e-mail dentro da transação → mesma recusa do CA-3', async () => {
    // A verificação prévia não vê o e-mail; a transação o encontra (simula o duplo envio).
    const e = entrada();
    const hashSenha = vi.fn(async (senha: string) => {
      await c.query(
        `INSERT INTO usuario (salao_id, papel, email, nome, senha_hash) VALUES ($1, 'profissional', $2, 'Corrida', 'x')`,
        [s.salaoId, e.email],
      );
      return `h-${senha.length}`;
    });
    const antes = await n('SELECT count(*) AS n FROM salao');
    expect(await cadastrar(e, deps(T0, { hashSenha }).d)).toEqual({
      ok: false,
      motivo: 'email_existente',
      erros: { email: MENSAGENS_CADASTRO.emailExistente },
    });
    expect(await n('SELECT count(*) AS n FROM salao')).toBe(antes);
  });

  it('RN-11/RN-17: as 5 rodadas de slug perdidas → falha genérica, nada gravado, detalhe só no log', async () => {
    // Erro injetado no próprio PostgreSQL (gatilho que descarta o INSERT do slug, como se outra
    // transação sempre gravasse o candidato antes): nenhuma rodada devolve linha.
    await c.query(`
      CREATE FUNCTION descarta_slug() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.slug LIKE 'esgota-tudo%' THEN RETURN NULL; END IF;
        RETURN NEW;
      END $$`);
    await c.query('CREATE TRIGGER descarta_slug BEFORE INSERT ON salao_slug FOR EACH ROW EXECUTE FUNCTION descarta_slug()');
    try {
      const antes = await contagens();
      const e = entrada({ nomeSalao: 'Esgota Tudo' });
      const { linhas, d } = deps();
      expect(await cadastrar(e, d)).toEqual({ ok: false, motivo: 'falha', mensagem: MENSAGENS_CADASTRO.falha });
      expect(await contagens()).toEqual(antes);
      expect(JSON.parse(linhas[0])).toEqual({
        evento: 'auth.cadastro',
        resultado: 'falha',
        detalhe: 'slug_esgotado',
        em: T0.toISOString(),
      });
    } finally {
      await c.query('DROP TRIGGER descarta_slug ON salao_slug');
      await c.query('DROP FUNCTION descarta_slug()');
    }
  });

  it('hash que lança → falha genérica, nada gravado', async () => {
    const antes = await contagens();
    const hashSenha = async (): Promise<string> => {
      throw new TypeError('quebrou');
    };
    expect(await cadastrar(entrada(), deps(T0, { hashSenha }).d)).toMatchObject({ ok: false, motivo: 'falha' });
    expect(await contagens()).toEqual(antes);
  });
});

describe('CA-17: falha no envio não desfaz o cadastro', () => {
  it('CA-17: adaptador que lança ErroEnvioEmail → sucesso com envio=falhou; reenvio posterior envia o link', async () => {
    const falha = {
      enviar: async () => {
        throw new ErroEnvioEmail('conexao', true);
      },
    };
    const e = entrada();
    const email = e.email as string;
    const { linhas, d } = deps(T0, { email: falha });
    expect(await cadastrar(e, d)).toEqual({ ok: true, email, envio: 'falhou' });
    const u = await usuarioPorEmail(email);
    expect(u.papel).toBe('gestor');
    expect(await n('SELECT count(*) AS n FROM token WHERE usuario_id = $1', [u.id])).toBe(1);
    expect(await emails(email)).toEqual([]);
    expect(JSON.parse(linhas[0])).toMatchObject({ evento: 'auth.cadastro', resultado: 'ok_envio_falhou', usuarioId: u.id });

    expect(await reenviarConfirmacao({ email }, { agora: T0, appUrl: APP_URL, log: () => {} })).toMatchObject({ ok: true });
    const [m] = await emails(email);
    expect(await confirmarEmail(tokenDoCorpo(m.corpo), { agora: T0, log: () => {} })).toBe('confirmado');
  });
});

describe('CA-19: logs do cadastro sem dados pessoais', () => {
  it('CA-19: sucesso, e-mail existente, validação e falha → auth.cadastro sem senha, e-mail, token nem hashes', async () => {
    const e = entrada();
    const { linhas, d } = deps();
    await cadastrar(e, d);
    await cadastrar(entrada({ email: e.email }), d);
    await cadastrar(entrada({ senha: 'curta' }), d);
    const email = e.email as string;
    const u = await usuarioPorEmail(email);
    const [m] = await emails(email);
    const token = tokenDoCorpo(m.corpo);
    const eventos = linhas.map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(eventos.map((x) => [x.evento, x.resultado])).toEqual([
      ['auth.cadastro', 'ok'],
      ['auth.cadastro', 'email_existente'],
      ['auth.cadastro', 'validacao'],
    ]);
    expect(eventos[0]).toEqual({
      evento: 'auth.cadastro',
      resultado: 'ok',
      salaoId: u.salao_id,
      usuarioId: u.id,
      em: T0.toISOString(),
    });
    const tudo = linhas.join('\n');
    for (const segredo of [SENHA, email, token, hashDoToken(token), u.senha_hash, 'Ana Souza']) {
      expect(tudo).not.toContain(segredo);
    }
  });
});
