import type pg from 'pg';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { aceitarConviteAcao } from '@/app/(publico)/convite/[token]/acoes';
import { ESTADO_INICIAL_CONVITE } from '@/app/(publico)/convite/[token]/estado';
import PaginaConvite, { dynamic, metadata } from '@/app/(publico)/convite/[token]/page';
import { convidarAcao } from '@/app/painel/profissionais/acoes';
import { ESTADO_INICIAL_CONVITE_PROFISSIONAL } from '@/app/painel/profissionais/estado';
import PaginaProfissional from '@/app/painel/profissionais/[id]/page';
import PaginaProfissionais from '@/app/painel/profissionais/page';
import { MENSAGENS_CONVITE } from '@/server/auth/convite';
import { gerarToken } from '@/server/auth/sessao';

import { criarSessao } from '../../support/auth';
import { criarDoisSaloes } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { DIA_MS, convitesDe, emailsDe, emitirConvite, novoProfissionalSemAcesso } from '../../support/convites';
import { conectar } from '../../support/sql';
import { ctxDoGestor } from '../profissionais/apoio';

// D-039 CA-3, CA-10, CA-11, CA-12, CA-14, CA-15, CA-16 na borda Next: /convite/[token], a casca do
// painel e as páginas de profissionais, com sessões reais. next/headers, next/navigation e next/cache são
// substituídos (não é mock de banco).

class Redirecionado extends Error {
  constructor(readonly destino: string) {
    super(`NEXT_REDIRECT ${destino}`);
  }
}

const estadoNext = vi.hoisted(() => ({ cookie: undefined as string | undefined, revalidados: [] as string[] }));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (nome: string) =>
      nome === 'ab_sessao' && estadoNext.cookie !== undefined ? { name: nome, value: estadoNext.cookie } : undefined,
  }),
}));
vi.mock('next/navigation', () => ({
  redirect: (destino: string) => {
    throw new Redirecionado(destino);
  },
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  usePathname: () => null,
}));
vi.mock('next/cache', () => ({
  revalidatePath: (caminho: string) => {
    estadoNext.revalidados.push(caminho);
  },
}));

const SENHA = 'uma-senha-forte-1';
let c: pg.Client;
let a: SalaoCompleto;
let b: SalaoCompleto;

beforeAll(async () => {
  c = await conectar();
  ({ a, b } = await criarDoisSaloes());
});
afterAll(async () => {
  await c.end();
});
beforeEach(() => {
  estadoNext.cookie = undefined;
  estadoNext.revalidados = [];
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

const formulario = (campos: Record<string, string | Blob>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
};
const pagina = async (token: string) => renderToStaticMarkup(await PaginaConvite({ params: Promise.resolve({ token }) }));
const comoGestor = async (s: SalaoCompleto) => {
  estadoNext.cookie = (await criarSessao(s.gestor.usuarioId)).token;
};

describe('/convite/[token]', () => {
  it('é dinâmica e noindex', () => {
    expect(dynamic).toBe('force-dynamic');
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it('CA-15: link válido mostra o formulário com o token só no campo oculto; GET não grava', async () => {
    const p = await novoProfissionalSemAcesso(c, a.salaoId);
    const { token } = await emitirConvite(ctxDoGestor(a), p.id);
    const antes = await convitesDe(c, p.id);
    const html = await pagina(token);
    expect(html).toContain('<h1>Ativar o seu acesso</h1>');
    expect(html).toContain(`name="token" value="${token}"`);
    expect(html).not.toContain(p.email);
    expect(html.split(token)).toHaveLength(2);
    expect(await convitesDe(c, p.id)).toEqual(antes);
  });

  it('CA-3: inexistente, malformado e já usado mostram a mesma recusa, sem formulário nem token', async () => {
    const p = await novoProfissionalSemAcesso(c, a.salaoId);
    const { token } = await emitirConvite(ctxDoGestor(a), p.id);
    await aceitarConviteAcao(ESTADO_INICIAL_CONVITE, formulario({ token, senha: SENHA }));
    for (const t of [gerarToken(), 'curto', token]) {
      const html = await pagina(t);
      expect(html, t).toContain('<h1>Convite inválido</h1>');
      expect(html).toContain(MENSAGENS_CONVITE.recusado.replace(/&/g, '&amp;'));
      expect(html).not.toContain('<form');
      expect(html).not.toContain(`value="${t}"`);
    }
  });
});

describe('aceitarConviteAcao', () => {
  it('mapeia sucesso, senha curta (formulário) e recusa; campos extras e arquivos são ignorados', async () => {
    const p = await novoProfissionalSemAcesso(c, a.salaoId);
    const { token } = await emitirConvite(ctxDoGestor(a), p.id);
    expect(await aceitarConviteAcao(ESTADO_INICIAL_CONVITE, formulario({ token, senha: '123' }))).toEqual({
      status: 'formulario',
      mensagem: null,
      erroSenha: MENSAGENS_CONVITE.senhaCurta,
    });
    expect(await aceitarConviteAcao(ESTADO_INICIAL_CONVITE, formulario({ token, senha: new Blob(['x']) }))).toMatchObject({
      status: 'formulario',
      erroSenha: MENSAGENS_CONVITE.senhaCurta,
    });
    const ok = await aceitarConviteAcao(ESTADO_INICIAL_CONVITE, formulario({ token, senha: SENHA, papel: 'gestor', salaoId: b.salaoId }));
    expect(ok).toEqual({ status: 'sucesso', mensagem: MENSAGENS_CONVITE.sucesso, erroSenha: null });
    const u = await c.query(`SELECT papel::text AS papel, salao_id::text AS salao FROM usuario WHERE email = $1`, [p.email]);
    expect(u.rows).toEqual([{ papel: 'profissional', salao: a.salaoId }]);
    expect(await aceitarConviteAcao(ESTADO_INICIAL_CONVITE, formulario({ token, senha: SENHA }))).toEqual({
      status: 'recusado',
      mensagem: MENSAGENS_CONVITE.recusado,
      erroSenha: null,
    });
    expect(await aceitarConviteAcao(ESTADO_INICIAL_CONVITE, formulario({ senha: SENHA }))).toMatchObject({ status: 'recusado' });
  });
});

describe('convidarAcao (casca do painel)', () => {
  const rodar = async (id: string) => convidarAcao(ESTADO_INICIAL_CONVITE_PROFISSIONAL, formulario({ id }));

  it('CA-1/CA-16: sucesso → estado "enviado", e-mail gravado e rota revalidada', async () => {
    await comoGestor(a);
    const p = await novoProfissionalSemAcesso(c, a.salaoId);
    expect(await rodar(p.id)).toEqual({ variante: 'sucesso', mensagem: MENSAGENS_CONVITE.enviado });
    expect(await emailsDe(c, p.email!)).toHaveLength(1);
    expect(estadoNext.revalidados).toContain(`/painel/profissionais/${p.id}`);
  });

  it('CA-10/CA-12: sem e-mail e limite viram erro com a mensagem do servidor', async () => {
    await comoGestor(a);
    const sem = await novoProfissionalSemAcesso(c, a.salaoId, { email: null });
    expect(await rodar(sem.id)).toEqual({ variante: 'erro', mensagem: MENSAGENS_CONVITE.semEmail });
    const p = await novoProfissionalSemAcesso(c, a.salaoId);
    for (let i = 0; i < 3; i++) await rodar(p.id);
    expect(await rodar(p.id)).toEqual({ variante: 'erro', mensagem: MENSAGENS_CONVITE.limite });
  });

  it('CA-14: e-mail que não sai (APP_URL inválida) vira aviso e o convite existe', async () => {
    await comoGestor(a);
    const p = await novoProfissionalSemAcesso(c, a.salaoId);
    vi.stubEnv('APP_URL', 'isto nao e url');
    try {
      expect(await rodar(p.id)).toEqual({ variante: 'aviso', mensagem: MENSAGENS_CONVITE.emailNaoEnviado });
    } finally {
      vi.unstubAllEnvs();
    }
    expect(await convitesDe(c, p.id)).toHaveLength(1);
    expect(await emailsDe(c, p.email!)).toHaveLength(0);
  });

  it('CA-11: profissional → acesso negado; outro salão → não encontrado; sem sessão → /entrar', async () => {
    const p = await novoProfissionalSemAcesso(c, a.salaoId);
    estadoNext.cookie = (await criarSessao(a.profissional.usuarioId)).token;
    expect(await rodar(p.id)).toEqual({ variante: 'erro', mensagem: MENSAGENS_CONVITE.acessoNegado });
    await comoGestor(b);
    expect(await rodar(p.id)).toEqual({ variante: 'erro', mensagem: MENSAGENS_CONVITE.naoEncontrado });
    estadoNext.cookie = undefined;
    await expect(rodar(p.id)).rejects.toMatchObject({ destino: `/entrar?proximo=${encodeURIComponent(`/painel/profissionais/${p.id}`)}` });
    expect(await convitesDe(c, p.id)).toHaveLength(0);
  });
});

describe('CA-16: estado do convite nas páginas do gestor', () => {
  const detalhe = async (id: string) => renderToStaticMarkup(await PaginaProfissional({ params: Promise.resolve({ id }) }));
  const lista = async () => renderToStaticMarkup(await PaginaProfissionais());

  it('sem convite → "Enviar convite"; pendente → "Reenviar convite", validade e selo na lista; sem token nem hash', async () => {
    await comoGestor(a);
    const p = await novoProfissionalSemAcesso(c, a.salaoId, { nome: 'Selo Pendente' });
    const antes = await detalhe(p.id);
    expect(antes).toContain('Nenhum convite enviado.');
    expect(antes).toContain('Enviar convite');
    expect(antes).not.toContain('Reenviar convite');

    const { token } = await emitirConvite(ctxDoGestor(a), p.id, new Date(Date.now()));
    const depois = await detalhe(p.id);
    expect(depois).toContain('Convite pendente, válido até');
    expect(depois).toContain('Reenviar convite');
    const [linha] = await convitesDe(c, p.id);
    for (const html of [depois, await lista()]) {
      expect(html).not.toContain(token);
      expect(html).not.toContain(linha.token_hash);
    }
    expect(await lista()).toContain('Sem acesso (convite pendente)');
  });

  it('expirado e aceito aparecem; inativo e sem e-mail explicam o que falta, sem botão', async () => {
    await comoGestor(a);
    const exp = await novoProfissionalSemAcesso(c, a.salaoId, { nome: 'Selo Expirado' });
    await emitirConvite(ctxDoGestor(a), exp.id, new Date(Date.now() - 8 * DIA_MS));
    const htmlExp = await detalhe(exp.id);
    expect(htmlExp).toContain('Convite expirado em');
    expect(htmlExp).toContain('Reenviar convite');
    expect(await lista()).toContain('Sem acesso (convite expirado)');

    const aceito = await novoProfissionalSemAcesso(c, a.salaoId, { nome: 'Selo Aceito' });
    const { token } = await emitirConvite(ctxDoGestor(a), aceito.id, new Date());
    await aceitarConviteAcao(ESTADO_INICIAL_CONVITE, formulario({ token, senha: SENHA }));
    const htmlAceito = await detalhe(aceito.id);
    expect(htmlAceito).toContain('Entra no painel com');
    expect(htmlAceito).not.toContain('Enviar convite');

    const inativo = await detalhe(a.profissionalInativoId);
    expect(inativo).toContain(MENSAGENS_CONVITE.inativo);
    expect(inativo).not.toContain('>Enviar convite<');
    const semEmail = await novoProfissionalSemAcesso(c, a.salaoId, { email: null });
    const htmlSem = await detalhe(semEmail.id);
    expect(htmlSem).toContain(MENSAGENS_CONVITE.semEmail);
    expect(htmlSem).not.toContain('>Enviar convite<');
  });

  it('CA-11: o profissional logado vê "Acesso negado" e nenhum controle de convite', async () => {
    const p = await novoProfissionalSemAcesso(c, a.salaoId);
    estadoNext.cookie = (await criarSessao(a.profissional.usuarioId)).token;
    const html = await detalhe(p.id);
    expect(html).toContain('Acesso negado');
    expect(html).not.toContain('Convite por e-mail');
  });
});
