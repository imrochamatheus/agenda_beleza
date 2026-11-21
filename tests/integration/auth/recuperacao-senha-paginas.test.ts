import type pg from 'pg';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { solicitarRecuperacaoAcao } from '@/app/(publico)/recuperar-senha/acoes';
import { ESTADO_INICIAL_RECUPERAR } from '@/app/(publico)/recuperar-senha/estado';
import PaginaRecuperarSenha, { metadata as metadataRecuperar } from '@/app/(publico)/recuperar-senha/page';
import { redefinirSenhaAcao } from '@/app/(publico)/redefinir-senha/acoes';
import { ESTADO_INICIAL_REDEFINIR } from '@/app/(publico)/redefinir-senha/estado';
import PaginaRedefinirSenha, { metadata as metadataRedefinir } from '@/app/(publico)/redefinir-senha/page';
import { novoTokenDeConfirmacao } from '@/server/auth/confirmacao-email';
import { MENSAGENS_RECUPERACAO, novoTokenDeRecuperacao, solicitarRecuperacao } from '@/server/auth/recuperacao-senha';
import { verificarSenha } from '@/server/auth/senha';

import nextConfig from '../../../next.config';
import { criarSalaoCompleto } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { conectar, emailNovo } from '../../support/sql';

// D-012 T-6: casca Next de /recuperar-senha e /redefinir-senha com PostgreSQL real. `after` de
// next/server é substituído por uma fila (não é mock de banco): prova que a ação devolve a resposta
// ANTES de buscar, emitir e enviar (D-4 b). CA-2 (casca), CA-5, CA-6 (página), CA-7 (casca), CA-13
// (campos extras ignorados), CA-18 (headers() do next.config.ts) e o mapeamento dos estados.
// Páginas renderizadas com renderToStaticMarkup.

const fila = vi.hoisted(() => ({ tarefas: [] as (() => Promise<void>)[] }));
vi.mock('next/server', () => ({
  after: (tarefa: () => Promise<void>) => {
    fila.tarefas.push(tarefa);
  },
}));

const T_ANTIGO = new Date('2020-01-01T00:00:00.000Z');
const SEM_BANCO = 'postgresql://usuario:senha@127.0.0.1:1/z';
const NOVA = 'nova-senha-9';

let c: pg.Client;

beforeAll(async () => {
  c = await conectar();
});
afterAll(async () => {
  await c.end();
});
beforeEach(() => {
  fila.tarefas = [];
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function formulario(campos: Record<string, string | Blob>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
}

async function n(sql: string, params: unknown[] = []): Promise<number> {
  return Number((await c.query<{ n: string }>(sql, params)).rows[0].n);
}

async function executarFila(): Promise<void> {
  const tarefas = fila.tarefas;
  fila.tarefas = [];
  for (const t of tarefas) await t();
}

/** Link válido (pelo serviço, com o adaptador simulado do registro) para o gestor do salão. */
async function link(s: SalaoCompleto): Promise<string> {
  await solicitarRecuperacao({ email: s.gestor.email }, { log: () => {} });
  const r = await c.query<{ corpo: string }>('SELECT corpo FROM email_log WHERE destinatario = $1 ORDER BY criado_em DESC, id DESC LIMIT 1', [
    s.gestor.email,
  ]);
  return /redefinir-senha\?token=([A-Za-z0-9_-]{43})/.exec(r.rows[0].corpo)![1];
}

async function renderizarRedefinir(busca: Record<string, string | string[]> = {}): Promise<string> {
  return renderToStaticMarkup(await PaginaRedefinirSenha({ searchParams: Promise.resolve(busca) }));
}

const senhaHash = async (usuarioId: string) =>
  (await c.query<{ senha_hash: string }>('SELECT senha_hash FROM usuario WHERE id = $1', [usuarioId])).rows[0].senha_hash;

describe('/recuperar-senha: página e solicitarRecuperacaoAcao', () => {
  it('CA-19: a página tem h1, o campo de e-mail e o link para /entrar; não consulta o banco', () => {
    vi.stubEnv('DATABASE_URL', SEM_BANCO);
    const html = renderToStaticMarkup(PaginaRecuperarSenha());
    expect(metadataRecuperar).toEqual({ title: 'Recuperar senha' });
    expect(html).toContain('<h1>Recuperar senha</h1>');
    expect(html).toMatch(/<input[^>]*type="email"[^>]*name="email"/);
    expect(html).toContain('Enviar link</button>');
    expect(html).toContain('href="/entrar"');
  });

  it('CA-2 (casca) e D-4 (b): existente e inexistente → estados idênticos; nada gravado antes do after(); depois, só o existente recebe', async () => {
    const s = await criarSalaoCompleto();
    const inexistente = emailNovo();
    const tokensAntes = await n('SELECT count(*) AS n FROM token');
    const emailsAntes = await n('SELECT count(*) AS n FROM email_log');

    const rExistente = await solicitarRecuperacaoAcao(ESTADO_INICIAL_RECUPERAR, formulario({ email: s.gestor.email }));
    const rInexistente = await solicitarRecuperacaoAcao(ESTADO_INICIAL_RECUPERAR, formulario({ email: inexistente }));
    const semEmail = (r: typeof rExistente) => ({ ...r, email: '' });
    expect(semEmail(rExistente)).toEqual(semEmail(rInexistente));
    expect(rExistente).toEqual({ mensagem: MENSAGENS_RECUPERACAO.uniforme, variante: 'sucesso', erroEmail: null, email: s.gestor.email });
    expect(Object.keys(rExistente)).toEqual(Object.keys(rInexistente));

    expect(fila.tarefas).toHaveLength(2);
    expect(await n('SELECT count(*) AS n FROM token')).toBe(tokensAntes);
    expect(await n('SELECT count(*) AS n FROM email_log')).toBe(emailsAntes);

    await executarFila();
    expect(await n(`SELECT count(*) AS n FROM token WHERE usuario_id = $1 AND tipo = 'recuperacao_senha'`, [s.gestor.usuarioId])).toBe(1);
    expect(await n('SELECT count(*) AS n FROM email_log WHERE destinatario = $1', [s.gestor.email])).toBe(1);
    expect(await n('SELECT count(*) AS n FROM email_log WHERE destinatario = $1', [inexistente])).toBe(0);
  });

  it('validação: erro no campo, sem tarefa; não-texto vira vazio; e-mail aparado e cortado em 254', async () => {
    const r = await solicitarRecuperacaoAcao(ESTADO_INICIAL_RECUPERAR, formulario({ email: `  ${'a'.repeat(300)}` }));
    expect(r).toEqual({ mensagem: null, variante: null, erroEmail: MENSAGENS_RECUPERACAO.emailInvalido, email: 'a'.repeat(254) });
    const blob = await solicitarRecuperacaoAcao(ESTADO_INICIAL_RECUPERAR, formulario({ email: new Blob(['x']) }));
    expect(blob).toEqual({ mensagem: null, variante: null, erroEmail: MENSAGENS_RECUPERACAO.emailInvalido, email: '' });
    expect(fila.tarefas).toHaveLength(0);
  });

  it('limite: a 4ª da janela → Alert de erro, sem tarefa', async () => {
    const email = emailNovo();
    for (let i = 0; i < 3; i++) {
      expect((await solicitarRecuperacaoAcao(ESTADO_INICIAL_RECUPERAR, formulario({ email }))).variante).toBe('sucesso');
    }
    fila.tarefas = [];
    expect(await solicitarRecuperacaoAcao(ESTADO_INICIAL_RECUPERAR, formulario({ email }))).toEqual({
      mensagem: MENSAGENS_RECUPERACAO.limite,
      variante: 'erro',
      erroEmail: null,
      email,
    });
    expect(fila.tarefas).toHaveLength(0);
  });

  it('CA-13: campos extras (salaoId, usuarioId) são ignorados: o alvo vem só do e-mail', async () => {
    const a = await criarSalaoCompleto();
    const b = await criarSalaoCompleto();
    await solicitarRecuperacaoAcao(
      ESTADO_INICIAL_RECUPERAR,
      formulario({ email: a.gestor.email, salaoId: b.salaoId, usuarioId: b.gestor.usuarioId }),
    );
    await executarFila();
    expect(await n(`SELECT count(*) AS n FROM token WHERE usuario_id = $1`, [a.gestor.usuarioId])).toBe(1);
    expect(await n(`SELECT count(*) AS n FROM token WHERE usuario_id = $1`, [b.gestor.usuarioId])).toBe(0);
  });
});

describe('/redefinir-senha: página (CA-5, CA-6, RN-10)', () => {
  it('D-12/RN-14: metadata sem referrer (a política vem do cabeçalho HTTP)', () => {
    expect(metadataRedefinir).toEqual({ title: 'Definir nova senha' });
  });

  it('CA-6: ausente, vazio, 10 KB, fora do formato e repetido → recusa sem formulário; não consulta o banco', async () => {
    vi.stubEnv('DATABASE_URL', SEM_BANCO);
    const casos: Record<string, string | string[]>[] = [
      {},
      { token: '' },
      { token: 'A'.repeat(10 * 1024) },
      { token: 'malformado' },
      { token: ['A'.repeat(43), 'B'.repeat(43)] },
    ];
    for (const busca of casos) {
      const html = await renderizarRedefinir(busca);
      expect(html).toContain('<h1>Link inválido</h1>');
      expect(html).toContain(MENSAGENS_RECUPERACAO.recusado);
      expect(html).toContain('href="/recuperar-senha"');
      expect(html).not.toContain('<form');
      expect(html).not.toContain('<input');
      expect(html).not.toMatch(/<meta[^>]*name="referrer"/);
    }
  });

  it('CA-5: link válido aberto 3 vezes → formulário com o token oculto nas 3; nada gravado; o token continua válido', async () => {
    const s = await criarSalaoCompleto();
    const token = await link(s);
    const antes = await c.query('SELECT * FROM token WHERE usuario_id = $1', [s.gestor.usuarioId]);
    for (let i = 0; i < 3; i++) {
      const html = await renderizarRedefinir({ token });
      expect(html).toContain('<h1>Definir nova senha</h1>');
      expect(html).toMatch(/<input[^>]*type="password"[^>]*name="senha"/);
      expect(html).toMatch(/autoComplete="new-password"|autocomplete="new-password"/);
      expect(html).toContain(`<input type="hidden" name="token" value="${token}"/>`);
      expect(html).toContain('Salvar nova senha</button>');
      expect(html.split(token)).toHaveLength(2);
    }
    expect((await c.query('SELECT * FROM token WHERE usuario_id = $1', [s.gestor.usuarioId])).rows).toEqual(antes.rows);
  });

  it('CA-6/RN-10: sem registro, de confirmação, usado, expirado, substituído e inelegível → recusa; o token não aparece', async () => {
    const s = await criarSalaoCompleto({ gestor: { emailConfirmado: false } });
    const conf = novoTokenDeConfirmacao(new Date());
    await c.query(`INSERT INTO token (usuario_id, tipo, token_hash, expira_em) VALUES ($1, 'confirmacao_email', $2, $3)`, [
      s.gestor.usuarioId,
      conf.tokenHash,
      conf.expiraEm,
    ]);
    const usado = await link(s);
    expect((await redefinirSenhaAcao(ESTADO_INICIAL_REDEFINIR, formulario({ token: usado, senha: NOVA }))).status).toBe('sucesso');

    const x = await criarSalaoCompleto();
    const substituido = await link(x);
    await link(x);
    const expirado = novoTokenDeRecuperacao(T_ANTIGO);
    await c.query(`INSERT INTO token (usuario_id, tipo, token_hash, expira_em) VALUES ($1, 'recuperacao_senha', $2, $3)`, [
      x.gestor.usuarioId,
      expirado.tokenHash,
      expirado.expiraEm,
    ]);
    const inelegivel = novoTokenDeRecuperacao(new Date());
    await c.query(`INSERT INTO token (usuario_id, tipo, token_hash, expira_em) VALUES ($1, 'recuperacao_senha', $2, $3)`, [
      x.profissional.usuarioId,
      inelegivel.tokenHash,
      inelegivel.expiraEm,
    ]);
    await c.query('UPDATE profissional SET ativo = false WHERE id = $1', [x.profissional.profissionalId]);

    for (const token of [novoTokenDeRecuperacao(new Date()).token, conf.token, usado, substituido, expirado.token, inelegivel.token]) {
      const html = await renderizarRedefinir({ token });
      expect(html).toContain('<h1>Link inválido</h1>');
      expect(html).toContain(MENSAGENS_RECUPERACAO.recusado);
      expect(html).not.toContain('<form');
      expect(html).not.toContain(token);
    }
  });
});

describe('/redefinir-senha: redefinirSenhaAcao', () => {
  it('CA-3 (casca): sucesso → status sucesso, sem senha nem token no estado; a nova senha vale', async () => {
    const s = await criarSalaoCompleto();
    const token = await link(s);
    const r = await redefinirSenhaAcao(ESTADO_INICIAL_REDEFINIR, formulario({ token, senha: NOVA }));
    expect(r).toEqual({ status: 'sucesso', mensagem: MENSAGENS_RECUPERACAO.sucesso, erroSenha: null });
    expect(JSON.stringify(r)).not.toContain(NOVA);
    expect(JSON.stringify(r)).not.toContain(token);
    expect(await verificarSenha(await senhaHash(s.gestor.usuarioId), NOVA)).toBe(true);
    // D-18: a re-renderização do POST sem JS veria o link já usado (o componente mostra o estado).
    expect(await renderizarRedefinir({ token })).toContain('<h1>Link inválido</h1>');
  });

  it('CA-7 (casca): curta, longa, ausente e não-texto → erro no campo; o token continua válido e a página ainda mostra o formulário', async () => {
    const s = await criarSalaoCompleto();
    const token = await link(s);
    const antes = await senhaHash(s.gestor.usuarioId);
    const casos: [Record<string, string | Blob>, string][] = [
      [{ token, senha: '1234567' }, MENSAGENS_RECUPERACAO.senhaCurta],
      [{ token, senha: 'x'.repeat(1025) }, MENSAGENS_RECUPERACAO.senhaLonga],
      [{ token }, MENSAGENS_RECUPERACAO.senhaCurta],
      [{ token, senha: new Blob(['senha-em-blob']) }, MENSAGENS_RECUPERACAO.senhaCurta],
    ];
    for (const [campos, erro] of casos) {
      const r = await redefinirSenhaAcao(ESTADO_INICIAL_REDEFINIR, formulario(campos));
      expect(r).toEqual({ status: 'formulario', mensagem: null, erroSenha: erro });
      expect(JSON.stringify(r)).not.toContain(token);
    }
    expect(await senhaHash(s.gestor.usuarioId)).toBe(antes);
    expect(await renderizarRedefinir({ token })).toContain(`<input type="hidden" name="token" value="${token}"/>`);
  });

  it('recusa: token ausente, não-texto ou desconhecido → status recusado com a mensagem única', async () => {
    const casos: Record<string, string | Blob>[] = [
      { senha: NOVA },
      { token: new Blob(['x']), senha: NOVA },
      { token: novoTokenDeRecuperacao(new Date()).token, senha: NOVA },
    ];
    for (const campos of casos) {
      expect(await redefinirSenhaAcao(ESTADO_INICIAL_REDEFINIR, formulario(campos))).toEqual({
        status: 'recusado',
        mensagem: MENSAGENS_RECUPERACAO.recusado,
        erroSenha: null,
      });
    }
  });

  it('CA-13: campos extras (usuarioId, salaoId de outro salão) são ignorados: só o dono do token muda', async () => {
    const a = await criarSalaoCompleto();
    const b = await criarSalaoCompleto();
    const hashB = await senhaHash(b.gestor.usuarioId);
    const token = await link(a);
    const r = await redefinirSenhaAcao(
      ESTADO_INICIAL_REDEFINIR,
      formulario({ token, senha: NOVA, usuarioId: b.gestor.usuarioId, salaoId: b.salaoId }),
    );
    expect(r.status).toBe('sucesso');
    expect(await senhaHash(b.gestor.usuarioId)).toBe(hashB);
    expect(await verificarSenha(await senhaHash(a.gestor.usuarioId), NOVA)).toBe(true);
  });

  it('falha do banco na transação → formulário com a mensagem genérica; nada muda', async () => {
    // Erro injetado pelo teste no próprio PostgreSQL (gatilho), não um mock: o UPDATE do usuário falha.
    const s = await criarSalaoCompleto({ gestor: { nome: 'Falha Forçada' } });
    const token = await link(s);
    const antes = await senhaHash(s.gestor.usuarioId);
    await c.query(`
      CREATE FUNCTION falha_forcada_senha() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.nome = 'Falha Forçada' AND NEW.senha_hash IS DISTINCT FROM OLD.senha_hash THEN
          RAISE EXCEPTION 'falha forçada';
        END IF;
        RETURN NEW;
      END $$`);
    await c.query('CREATE TRIGGER falha_forcada_senha BEFORE UPDATE ON usuario FOR EACH ROW EXECUTE FUNCTION falha_forcada_senha()');
    try {
      const r = await redefinirSenhaAcao(ESTADO_INICIAL_REDEFINIR, formulario({ token, senha: NOVA }));
      expect(r).toEqual({ status: 'formulario', mensagem: MENSAGENS_RECUPERACAO.falha, erroSenha: null });
    } finally {
      await c.query('DROP TRIGGER falha_forcada_senha ON usuario');
      await c.query('DROP FUNCTION falha_forcada_senha()');
    }
    expect(await senhaHash(s.gestor.usuarioId)).toBe(antes);
    expect(await renderizarRedefinir({ token })).toContain('<h1>Definir nova senha</h1>');
  });
});

describe('CA-18: Referrer-Policy por cabeçalho HTTP (next.config.ts)', () => {
  it('strict-origin em /redefinir-senha e /confirmar-email; nunca no-referrer; /recuperar-senha sem cabeçalho', async () => {
    const regras = await nextConfig.headers!();
    expect(regras).toEqual([
      { source: '/confirmar-email', headers: [{ key: 'Referrer-Policy', value: 'strict-origin' }] },
      { source: '/redefinir-senha', headers: [{ key: 'Referrer-Policy', value: 'strict-origin' }] },
      // D-032: a rota do convite de avaliação (token no caminho) acrescenta cache e indexação.
      {
        source: '/:slug/avaliar/:token',
        headers: [
          { key: 'Referrer-Policy', value: 'strict-origin' },
          { key: 'Cache-Control', value: 'no-store' },
          { key: 'X-Robots-Tag', value: 'noindex' },
        ],
      },
    ]);
    expect(JSON.stringify(regras)).not.toContain('no-referrer');
    expect(regras.map((r) => r.source)).not.toContain('/recuperar-senha');
  });
});
