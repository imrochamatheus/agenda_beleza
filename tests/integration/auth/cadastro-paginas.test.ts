import type pg from 'pg';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { cadastrarAcao } from '@/app/(publico)/cadastro/acoes';
import { ESTADO_INICIAL_CADASTRO } from '@/app/(publico)/cadastro/estado';
import PaginaCadastro, { metadata as metadataCadastro } from '@/app/(publico)/cadastro/page';
import { reenviarConfirmacaoAcao } from '@/app/(publico)/confirmar-email/acoes';
import { ESTADO_INICIAL_REENVIO } from '@/app/(publico)/confirmar-email/estado';
import PaginaConfirmarEmail, { metadata as metadataConfirmar } from '@/app/(publico)/confirmar-email/page';
import { entrarAcao } from '@/app/(publico)/entrar/acoes';
import { ESTADO_INICIAL_ENTRAR } from '@/app/(publico)/entrar/estado';
import PaginaPainel from '@/app/painel/page';
import { MENSAGENS_CADASTRO } from '@/server/auth/cadastro';
import { MENSAGENS_CONFIRMACAO, novoTokenDeConfirmacao } from '@/server/auth/confirmacao-email';
import { MENSAGENS_LOGIN } from '@/server/auth/login';
import { redefinirIntegracoes } from '@/server/integrations/registry';
import { repos } from '@/server/repos';
import { NaoEncontrado } from '@/server/tenant/erros';
import { resolverTenant } from '@/server/tenant/sessao';

import { criarSalaoCompleto } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { conectar, criarServico, emailNovo } from '../../support/sql';

// D-011 T-7: casca Next de /cadastro, /confirmar-email e do reenvio em /entrar, com PostgreSQL real.
// next/headers (cookies) e next/navigation (redirect) são substituídos (não é mock de banco), como em
// paginas.test.ts. CA-4/CA-5 (tela), CA-6 (casca), CA-17 (aviso), CA-18 (isolamento com salões
// criados por este fluxo) e as ações. Páginas renderizadas com renderToStaticMarkup.

class Redirecionado extends Error {
  constructor(readonly destino: string) {
    super(`NEXT_REDIRECT ${destino}`);
  }
}

type Gravacao = { nome: string; valor: string };
const jar = vi.hoisted(() => ({ valor: undefined as string | undefined, gravacoes: [] as Gravacao[] }));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (nome: string) =>
      nome === 'ab_sessao' && jar.valor !== undefined ? { name: nome, value: jar.valor } : undefined,
    set: (nome: string, valor: string) => {
      jar.gravacoes.push({ nome, valor });
    },
  }),
}));
vi.mock('next/navigation', () => ({
  redirect: (destino: string) => {
    throw new Redirecionado(destino);
  },
  usePathname: () => null,
}));

const SENHA = 'senha-forte-1';
const SEM_BANCO = 'postgresql://usuario:senha@127.0.0.1:1/z';

let c: pg.Client;
let s: SalaoCompleto;

beforeAll(async () => {
  c = await conectar();
  s = await criarSalaoCompleto();
});
afterAll(async () => {
  await c.end();
});
beforeEach(() => {
  jar.valor = undefined;
  jar.gravacoes = [];
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  redefinirIntegracoes();
});

function formulario(campos: Record<string, string | Blob>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
}

function campos(parcial: Record<string, string> = {}) {
  return { nome: 'Ana Souza', email: emailNovo(), senha: SENHA, nomeSalao: 'Salão da Casca', ...parcial };
}

async function ultimoToken(email: string): Promise<string> {
  const r = await c.query<{ corpo: string }>(
    'SELECT corpo FROM email_log WHERE destinatario = $1 ORDER BY criado_em DESC, id DESC LIMIT 1',
    [email],
  );
  return /confirmar-email\?token=([A-Za-z0-9_-]{43})/.exec(r.rows[0].corpo)![1];
}

async function totalEmails(email: string): Promise<number> {
  return Number((await c.query<{ n: string }>('SELECT count(*) AS n FROM email_log WHERE destinatario = $1', [email])).rows[0].n);
}

async function renderizarConfirmar(busca: Record<string, string | string[]> = {}): Promise<string> {
  return renderToStaticMarkup(await PaginaConfirmarEmail({ searchParams: Promise.resolve(busca) }));
}

async function destinoDe(p: Promise<unknown>): Promise<string> {
  const erro = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(erro).toBeInstanceOf(Redirecionado);
  return (erro as Redirecionado).destino;
}

describe('/cadastro: página e cadastrarAcao', () => {
  it('CA-20: a página tem h1, os quatro campos e não consulta o banco', () => {
    vi.stubEnv('DATABASE_URL', SEM_BANCO);
    const html = renderToStaticMarkup(PaginaCadastro());
    expect(metadataCadastro.title).toBe('Criar conta do salão');
    expect(html).toContain('<h1>Criar conta do salão</h1>');
    for (const nome of ['nome', 'email', 'senha', 'nomeSalao']) {
      expect(html).toMatch(new RegExp(`<input[^>]*name="${nome}"`));
    }
    expect(html).toMatch(/<input[^>]*autoComplete="new-password"|<input[^>]*autocomplete="new-password"/);
    expect(html).toContain('href="/entrar"');
  });

  it('CA-1 (casca): sucesso → status sucesso com o e-mail normalizado, sem senha e sem cookie', async () => {
    const f = campos({ email: '  Casca.Ok@Exemplo.COM ' });
    const r = await cadastrarAcao(ESTADO_INICIAL_CADASTRO, formulario(f));
    expect(r).toEqual({
      status: 'sucesso',
      mensagem: null,
      emailExistente: false,
      erros: {},
      valores: { nome: 'Ana Souza', email: 'casca.ok@exemplo.com', nomeSalao: 'Salão da Casca' },
      avisoEnvio: null,
    });
    expect(JSON.stringify(r)).not.toContain(SENHA);
    expect(jar.gravacoes).toEqual([]);
    expect(await totalEmails('casca.ok@exemplo.com')).toBe(1);
  });

  it('CA-10 (casca): validação → erros por campo; valores aparados e cortados; senha nunca volta; não-texto vira vazio', async () => {
    const r = await cadastrarAcao(
      ESTADO_INICIAL_CADASTRO,
      formulario({ nome: `  ${'n'.repeat(300)}`, email: new Blob(['x']), senha: 'curta', nomeSalao: '  ' }),
    );
    expect(r.status).toBe('editando');
    expect(r.erros).toEqual({
      nome: MENSAGENS_CADASTRO.nome,
      email: MENSAGENS_CADASTRO.email,
      senha: MENSAGENS_CADASTRO.senhaCurta,
      nomeSalao: MENSAGENS_CADASTRO.nomeSalao,
    });
    expect(r.valores).toEqual({ nome: 'n'.repeat(100), email: '', nomeSalao: '' });
    expect([r.mensagem, r.emailExistente]).toEqual([null, false]);
    expect(JSON.stringify(r)).not.toContain('curta');
  });

  it('CA-3 (casca): e-mail existente → mensagem geral + erro no campo + emailExistente', async () => {
    const r = await cadastrarAcao(ESTADO_INICIAL_CADASTRO, formulario(campos({ email: s.gestor.email })));
    expect(r).toMatchObject({
      status: 'editando',
      mensagem: MENSAGENS_CADASTRO.emailExistente,
      emailExistente: true,
      erros: { email: MENSAGENS_CADASTRO.emailExistente },
      valores: { email: s.gestor.email },
    });
  });

  it('CA-17 (casca): adaptador de e-mail indisponível → sucesso com o aviso de envio', async () => {
    // Modo real sem as variáveis SMTP: o registro recusa o ambiente depois do commit.
    vi.stubEnv('EMAIL_ADAPTER', 'real');
    redefinirIntegracoes();
    const f = campos();
    const r = await cadastrarAcao(ESTADO_INICIAL_CADASTRO, formulario(f));
    expect(r).toMatchObject({ status: 'sucesso', avisoEnvio: MENSAGENS_CADASTRO.avisoEnvio });
    const u = await c.query('SELECT papel FROM usuario WHERE email = $1', [f.email]);
    expect(u.rows).toEqual([{ papel: 'gestor' }]);
    expect(await totalEmails(f.email)).toBe(0);
  });

  it('RN-17 (casca): erro do banco dentro da transação → mensagem genérica, nada gravado', async () => {
    // Erro injetado pelo teste no próprio PostgreSQL (gatilho), não um mock: o INSERT do token falha.
    await c.query(`
      CREATE FUNCTION falha_forcada() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF EXISTS (SELECT 1 FROM usuario WHERE id = NEW.usuario_id AND nome = 'Falha Forçada') THEN
          RAISE EXCEPTION 'falha forçada';
        END IF;
        RETURN NEW;
      END $$`);
    await c.query('CREATE TRIGGER falha_forcada BEFORE INSERT ON token FOR EACH ROW EXECUTE FUNCTION falha_forcada()');
    try {
      const f = campos({ nome: 'Falha Forçada', nomeSalao: 'Salão Que Falha' });
      const r = await cadastrarAcao(ESTADO_INICIAL_CADASTRO, formulario(f));
      expect(r).toMatchObject({ status: 'editando', mensagem: MENSAGENS_CADASTRO.falha, emailExistente: false, erros: {} });
      const sal = await c.query(`SELECT id FROM salao WHERE nome = 'Salão Que Falha'`);
      expect(sal.rows).toEqual([]);
      expect(await totalEmails(f.email)).toBe(0);
    } finally {
      await c.query('DROP TRIGGER falha_forcada ON token');
      await c.query('DROP FUNCTION falha_forcada()');
    }
  });
});

describe('/confirmar-email: página por resultado (CA-4, CA-5, CA-14, D-14, D-15)', () => {
  it('D-15 (rodada 2): metadata sem referrer (a política vem do cabeçalho HTTP; no-referrer quebrava o POST sem JS)', () => {
    expect(metadataConfirmar).toEqual({ title: 'Confirmar e-mail' });
  });

  it('D-14: sem token → formulário de reenvio com campo de e-mail, sem consultar o banco', async () => {
    vi.stubEnv('DATABASE_URL', SEM_BANCO);
    const html = await renderizarConfirmar();
    expect(html).toContain('<h1>Reenviar link de confirmação</h1>');
    expect(html).toMatch(/<input[^>]*type="email"[^>]*name="email"/);
    expect(html).toContain('Reenviar link de confirmação</button>');
  });

  it('CA-4 (tela): confirmado → mensagem e link para /entrar; reabrir → já utilizado, sem reenvio', async () => {
    const f = campos();
    await cadastrarAcao(ESTADO_INICIAL_CADASTRO, formulario(f));
    const token = await ultimoToken(f.email);
    const html = await renderizarConfirmar({ token });
    expect(html).toContain('<h1>E-mail confirmado</h1>');
    expect(html).toContain(MENSAGENS_CONFIRMACAO.confirmado);
    expect(html).toContain('href="/entrar"');
    expect(html).not.toContain(token);

    const de_novo = await renderizarConfirmar({ token });
    expect(de_novo).toContain(MENSAGENS_CONFIRMACAO.jaUtilizado);
    expect(de_novo).toContain('href="/entrar"');
    expect(de_novo).not.toContain('<form');
    expect(de_novo).not.toContain(token);
  });

  it('CA-5 (tela): expirado → mensagem e reenvio por token em campo oculto (POST); o token não aparece em link', async () => {
    const f = campos();
    await cadastrarAcao(ESTADO_INICIAL_CADASTRO, formulario(f));
    const token = await ultimoToken(f.email);
    await c.query(`UPDATE token SET expira_em = now() - interval '1 second' WHERE usuario_id = (SELECT id FROM usuario WHERE email = $1)`, [
      f.email,
    ]);
    const html = await renderizarConfirmar({ token });
    expect(html).toContain('<h1>Link expirado</h1>');
    expect(html).toContain(MENSAGENS_CONFIRMACAO.expirado);
    expect(html).toMatch(new RegExp(`<input type="hidden" name="token" value="${token}"/>`));
    expect(html).not.toMatch(new RegExp(`href="[^"]*${token}`));
    expect(html).not.toMatch(/<input[^>]*type="email"/);

    // O botão envia o token pela ação: novo link por e-mail, que confirma.
    const r = await reenviarConfirmacaoAcao(ESTADO_INICIAL_REENVIO, formulario({ token }));
    expect(r).toEqual({ mensagem: MENSAGENS_CONFIRMACAO.reenvioUniforme, variante: 'sucesso', erroEmail: null, email: '' });
    const novo = await ultimoToken(f.email);
    expect(novo).not.toBe(token);
    expect(await renderizarConfirmar({ token: novo })).toContain(MENSAGENS_CONFIRMACAO.confirmado);
  });

  it('CA-14 (tela): vazio, malformado, desconhecido e repetido → inválido com reenvio por e-mail', async () => {
    for (const token of ['', 'abc', novoTokenDeConfirmacao(new Date()).token, ['a', 'b']]) {
      const html = await renderizarConfirmar({ token });
      expect(html).toContain('<h1>Link inválido</h1>');
      expect(html).toContain(MENSAGENS_CONFIRMACAO.invalido);
      expect(html).toMatch(/<input[^>]*type="email"[^>]*name="email"/);
    }
  });
});

describe('reenviarConfirmacaoAcao', () => {
  it('por e-mail: uniforme (existente ou não); validação no campo; o 4º pedido da janela recebe o limite', async () => {
    const f = campos();
    await cadastrarAcao(ESTADO_INICIAL_CADASTRO, formulario(f));
    const r = await reenviarConfirmacaoAcao(ESTADO_INICIAL_REENVIO, formulario({ email: ` ${f.email} ` }));
    expect(r).toEqual({ mensagem: MENSAGENS_CONFIRMACAO.reenvioUniforme, variante: 'sucesso', erroEmail: null, email: f.email });
    expect(await totalEmails(f.email)).toBe(2);

    const inexistente = emailNovo();
    const respostas = [];
    for (let i = 0; i < 4; i++) {
      respostas.push(await reenviarConfirmacaoAcao(ESTADO_INICIAL_REENVIO, formulario({ email: inexistente })));
    }
    expect(respostas.map((x) => [x.variante, x.mensagem])).toEqual([
      ['sucesso', MENSAGENS_CONFIRMACAO.reenvioUniforme],
      ['sucesso', MENSAGENS_CONFIRMACAO.reenvioUniforme],
      ['sucesso', MENSAGENS_CONFIRMACAO.reenvioUniforme],
      ['erro', MENSAGENS_CONFIRMACAO.reenvioLimite],
    ]);

    const v = await reenviarConfirmacaoAcao(ESTADO_INICIAL_REENVIO, formulario({ email: 'sem-arroba' }));
    expect(v).toEqual({ mensagem: null, variante: null, erroEmail: MENSAGENS_CONFIRMACAO.emailInvalido, email: 'sem-arroba' });
    const semCampo = await reenviarConfirmacaoAcao(ESTADO_INICIAL_REENVIO, new FormData());
    expect(semCampo.erroEmail).toBe(MENSAGENS_CONFIRMACAO.emailInvalido);
  });
});

describe('CA-6 (casca): /entrar oferece o reenvio só ao não confirmado', () => {
  it('CA-6: senha certa e não confirmado → reenvioDisponivel; senha errada → não; o reenvio pelo e-mail oculto envia', async () => {
    const f = campos();
    await cadastrarAcao(ESTADO_INICIAL_CADASTRO, formulario(f));
    const r = await entrarAcao(ESTADO_INICIAL_ENTRAR, formulario({ email: f.email, senha: SENHA }));
    expect(r).toEqual({ mensagem: MENSAGENS_LOGIN.naoConfirmado, erros: {}, email: f.email, reenvioDisponivel: true });
    expect(jar.gravacoes).toEqual([]);
    const errada = await entrarAcao(ESTADO_INICIAL_ENTRAR, formulario({ email: f.email, senha: 'errada!!' }));
    expect(errada).toEqual({ mensagem: MENSAGENS_LOGIN.credenciais, erros: {}, email: f.email, reenvioDisponivel: false });

    // O formulário irmão envia `email` (oculto) para a mesma ação de reenvio.
    expect(await reenviarConfirmacaoAcao(ESTADO_INICIAL_REENVIO, formulario({ email: r.email }))).toMatchObject({
      variante: 'sucesso',
    });
    expect(await totalEmails(f.email)).toBe(2);
  });
});

describe('CA-18: dois salões cadastrados e confirmados por este fluxo ficam isolados', () => {
  it('CA-18: o gestor de B vê só o salão B no /painel e não lê nem altera dados de A', async () => {
    const a = campos({ nome: 'Gestora Alfa', nomeSalao: 'Salão Alfa Isolado' });
    const b = campos({ nome: 'Gestora Beta', nomeSalao: 'Salão Beta Isolado' });
    for (const f of [a, b]) {
      expect(await cadastrarAcao(ESTADO_INICIAL_CADASTRO, formulario(f))).toMatchObject({ status: 'sucesso' });
      expect(await renderizarConfirmar({ token: await ultimoToken(f.email) })).toContain(MENSAGENS_CONFIRMACAO.confirmado);
    }

    expect(await destinoDe(entrarAcao(ESTADO_INICIAL_ENTRAR, formulario({ email: b.email, senha: SENHA })))).toBe('/painel');
    expect(jar.gravacoes).toHaveLength(1);
    jar.valor = jar.gravacoes[0].valor;
    const html = renderToStaticMarkup(await PaginaPainel());
    expect(html).toContain('Salão Beta Isolado');
    expect(html).toContain('Olá, Gestora Beta');
    expect(html).not.toContain('Salão Alfa Isolado');
    expect(html).not.toContain('Gestora Alfa');

    const salaoA = await c.query<{ salao_id: string }>('SELECT salao_id FROM usuario WHERE email = $1', [a.email]);
    const servicoDeA = await criarServico(c, salaoA.rows[0].salao_id);
    const ctxB = await resolverTenant({ token: jar.valor });
    expect(ctxB.papel).toBe('gestor');
    expect(ctxB.salaoId).not.toBe(salaoA.rows[0].salao_id);
    await expect(repos().servicos.buscarPorId(ctxB, servicoDeA)).rejects.toBeInstanceOf(NaoEncontrado);
    await expect(repos().servicos.renomear(ctxB, servicoDeA, 'Invadido')).rejects.toBeInstanceOf(NaoEncontrado);
    const servico = await c.query('SELECT nome FROM servico WHERE id = $1', [servicoDeA]);
    expect(servico.rows).toEqual([{ nome: 'Corte' }]);
    expect(await repos().servicos.listar(ctxB)).toEqual([]);
  });
});
