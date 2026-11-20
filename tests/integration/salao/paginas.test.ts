import type pg from 'pg';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { salvarConfiguracoesAcao, trocarSlugAcao } from '@/app/painel/configuracoes/acoes';
import { estadoRegrasInicial, estadoSlugInicial } from '@/app/painel/configuracoes/estado';
import PaginaConfiguracoes from '@/app/painel/configuracoes/page';
import PaginaBloqueios from '@/app/painel/bloqueios/page';
import { ROTAS } from '@/config/navegacao';
import { criarSalaoComGestor } from '@/server/repos/cadastro';
import { MENSAGENS_CONFIGURACOES as M } from '@/server/salao/tipos';

import { criarSessao, criarSuperAdmin } from '../../support/auth';
import { criarDoisSaloes, criarSalaoCompleto } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { conectar, emailNovo } from '../../support/sql';

import { MANAUS, SP, atuaisDe, linhaSalao, slugsDe } from './apoio';

// D-017 T-8: página e casca de /painel/configuracoes com sessões reais no PostgreSQL. next/headers
// (cookies), next/navigation (redirect, notFound) e next/cache (revalidatePath) são substituídos (não é
// mock de banco). A página é renderizada com renderToStaticMarkup.

class Redirecionado extends Error {
  constructor(readonly destino: string) {
    super(`NEXT_REDIRECT ${destino}`);
  }
}

const estadoNext = vi.hoisted(() => ({ cookie: undefined as string | undefined, revalidados: [] as [string, string | undefined][] }));

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
  revalidatePath: (caminho: string, tipo?: string) => {
    estadoNext.revalidados.push([caminho, tipo]);
  },
}));

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

async function comoGestor(s: SalaoCompleto): Promise<void> {
  estadoNext.cookie = (await criarSessao(s.gestor.usuarioId)).token;
}
async function comoProfissional(s: SalaoCompleto): Promise<void> {
  estadoNext.cookie = (await criarSessao(s.profissional.usuarioId)).token;
}

async function destinoDe(p: Promise<unknown>): Promise<string> {
  const e = await p.then(
    () => {
      throw new Error('esperava redirect');
    },
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(Redirecionado);
  return (e as Redirecionado).destino;
}

const pagina = async () => renderToStaticMarkup(await PaginaConfiguracoes());

function formulario(campos: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
}
const regrasFd = (extra: Record<string, string> = {}) =>
  formulario({ nome: 'Studio Bela', fuso: SP, grade: '15', antecedencia: '2', janela: '60', intervalo: '0', ...extra });

/** `<option … selected>` do valor, no HTML estático. */
const selecionado = (html: string, valor: string) => new RegExp(`<option[^>]*value="${valor.replace('/', '\\/')}"[^>]*selected`).test(html);

describe('página: gestor', () => {
  it('CA-4 e CA-3: após salvar grade 30 e Manaus pela casca, a página mostra os dois selecionados; revalida o layout', async () => {
    const s = await criarSalaoCompleto();
    await comoGestor(s);
    const r = await salvarConfiguracoesAcao(estadoRegrasInicial(), regrasFd({ grade: '30', fuso: MANAUS, nome: s.nome }));
    expect(r).toEqual({
      mensagem: null,
      sucesso: M.regrasSalvas,
      erros: {},
      valores: { nome: s.nome, fuso: MANAUS, grade: '30', antecedencia: '2', janela: '60', intervalo: '0' },
    });
    expect(estadoNext.revalidados).toEqual([[ROTAS.painel, 'layout']]);
    const html = await pagina();
    expect(html).toContain('<h1>Configurações</h1>');
    expect(selecionado(html, '30')).toBe(true);
    expect(selecionado(html, MANAUS)).toBe(true);
    expect(selecionado(html, SP)).toBe(false);
    expect(html).toContain('<optgroup label="Brasil">');
    expect(html).toContain('<optgroup label="Outros">');
  });

  it('CA-7: o novo nome aparece no cabeçalho desta e de outra página do painel', async () => {
    const s = await criarSalaoCompleto();
    await comoGestor(s);
    await salvarConfiguracoesAcao(estadoRegrasInicial(), regrasFd({ nome: '  Studio   Bela Nova ' }));
    expect((await linhaSalao(c, s.salaoId)).nome).toBe('Studio Bela Nova');
    expect(await pagina()).toContain('Studio Bela Nova');
    expect(renderToStaticMarkup(await PaginaBloqueios({ searchParams: Promise.resolve({}) }))).toContain('Studio Bela Nova');
  });

  it('CA-17: salão do cadastro mostra fuso SP, grade 15, antecedência 2, janela 60, intervalo 0 e o slug sem anteriores', async () => {
    const r = await criarSalaoComGestor({
      nomeSalao: 'Studio Do Cadastro',
      slugBase: 'studio-do-cadastro',
      nomeGestor: 'Gestora Cadastro',
      email: emailNovo(),
      senhaHash: 'hash-ficticio',
      tokenHash: `t-${emailNovo()}`,
      expiraEm: new Date(Date.now() + 3_600_000),
      agora: new Date(),
    });
    if (!r.ok) throw new Error('cadastro falhou');
    await c.query('UPDATE usuario SET email_confirmado_em = now() WHERE id = $1', [r.usuarioId]);
    estadoNext.cookie = (await criarSessao(r.usuarioId)).token;
    const html = await pagina();
    expect(selecionado(html, SP)).toBe(true);
    expect(selecionado(html, '15')).toBe(true);
    expect(html).toMatch(/name="antecedencia"[^>]*value="2"|value="2"[^>]*name="antecedencia"/);
    expect(html).toMatch(/name="janela"[^>]*value="60"|value="60"[^>]*name="janela"/);
    expect(html).toMatch(/name="intervalo"[^>]*value="0"|value="0"[^>]*name="intervalo"/);
    expect(html).toContain(`/${r.slug}`);
    expect(html).toContain(M.semAnteriores);
  });

  it('CA-15: a página de A mostra só os valores e o histórico de A', async () => {
    await comoGestor(a);
    const html = await pagina();
    expect(html).toContain(`/${a.slugAtual}`);
    expect(html).toContain(`/${a.slugHistorico}`);
    expect(html).not.toContain(b.slugAtual);
    expect(html).not.toContain(b.slugHistorico);
    expect(html).not.toContain(b.nome);
  });
});

describe('página: acesso', () => {
  it('CA-14: profissional vê "Acesso negado" sem dados do salão', async () => {
    await comoProfissional(a);
    const html = await pagina();
    expect(html).toContain('Acesso negado');
    expect(html).not.toContain(a.nome);
    expect(html).not.toContain(a.slugAtual);
    expect(html).not.toContain('name="fuso"');
  });

  it('CA-14: gestor com perfil de profissional tem acesso', async () => {
    expect(a.gestor.profissionalId).not.toBeNull();
    await comoGestor(a);
    expect(await pagina()).toContain('<h1>Configurações</h1>');
  });

  it('CA-14: sem sessão → /entrar?proximo=%2Fpainel%2Fconfiguracoes; super admin → acesso negado', async () => {
    expect(await destinoDe(PaginaConfiguracoes())).toBe('/entrar?proximo=%2Fpainel%2Fconfiguracoes');
    estadoNext.cookie = (await criarSuperAdmin({ totpVerificado: true })).credencial?.token;
    const html = await pagina();
    expect(html).toContain('Acesso negado');
    expect(html).not.toContain('name="fuso"');
  });
});

describe('casca', () => {
  it('CA-20: inválido devolve os erros com os valores digitados; salaoId de B descartado; nada gravado', async () => {
    const s = await criarSalaoCompleto();
    await comoGestor(s);
    const antes = await linhaSalao(c, s.salaoId);
    const bAntes = await linhaSalao(c, b.salaoId);
    const r = await salvarConfiguracoesAcao(estadoRegrasInicial(), regrasFd({ grade: '7', intervalo: 'abc', nome: 'Outro', salaoId: b.salaoId }));
    expect(r).toEqual({
      mensagem: null,
      sucesso: null,
      erros: { grade: M.grade, intervalo: M.intervalo },
      valores: { nome: 'Outro', fuso: SP, grade: '7', antecedencia: '2', janela: '60', intervalo: 'abc' },
    });
    expect(estadoNext.revalidados).toEqual([]);
    expect(await linhaSalao(c, s.salaoId)).toEqual(antes);
    expect(await linhaSalao(c, b.salaoId)).toEqual(bAntes);
  });

  it('slug: trocado (campo vazio, revalida), sem efeito, inválido com o valor e em uso', async () => {
    const s = await criarSalaoCompleto();
    await comoGestor(s);
    const novo = `${s.slugAtual}-casca`;
    expect(await trocarSlugAcao(estadoSlugInicial(), formulario({ slug: ` ${novo.toUpperCase()} `, salaoId: b.salaoId }))).toEqual({
      mensagem: null,
      sucesso: M.slugTrocado,
      erros: {},
      valor: '',
    });
    expect(estadoNext.revalidados).toEqual([[ROTAS.painel, 'layout']]);
    expect(await atuaisDe(c, s.salaoId)).toEqual([novo]);
    expect(await trocarSlugAcao(estadoSlugInicial(), formulario({ slug: novo }))).toEqual({ mensagem: null, sucesso: M.slugSemEfeito, erros: {}, valor: '' });
    expect(await trocarSlugAcao(estadoSlugInicial(), formulario({ slug: 'painel' }))).toEqual({
      mensagem: null,
      sucesso: null,
      erros: { slug: M.slugReservado },
      valor: 'painel',
    });
    expect(await trocarSlugAcao(estadoSlugInicial(), formulario({ slug: b.slugHistorico }))).toEqual({
      mensagem: null,
      sucesso: null,
      erros: { slug: M.slugEmUso },
      valor: b.slugHistorico,
    });
    expect(estadoNext.revalidados).toHaveLength(1);
    const html = await pagina();
    expect(html).toContain(`/${novo}`);
    expect(html).toContain(`/${s.slugAtual}`);
  });

  it('profissional → mensagem de acesso negado com os valores; sem sessão → redirect para /entrar (fora de try)', async () => {
    await comoProfissional(a);
    const antes = await slugsDe(c, a.salaoId);
    expect(await salvarConfiguracoesAcao(estadoRegrasInicial(), regrasFd({ nome: 'Invasão' }))).toEqual({
      mensagem: M.acessoNegado,
      sucesso: null,
      erros: {},
      valores: { nome: 'Invasão', fuso: SP, grade: '15', antecedencia: '2', janela: '60', intervalo: '0' },
    });
    expect(await trocarSlugAcao(estadoSlugInicial(), formulario({ slug: 'invasao' }))).toEqual({
      mensagem: M.acessoNegado,
      sucesso: null,
      erros: {},
      valor: 'invasao',
    });
    expect(await slugsDe(c, a.salaoId)).toEqual(antes);
    estadoNext.cookie = undefined;
    const destino = '/entrar?proximo=%2Fpainel%2Fconfiguracoes';
    expect(await destinoDe(salvarConfiguracoesAcao(estadoRegrasInicial(), regrasFd()))).toBe(destino);
    expect(await destinoDe(trocarSlugAcao(estadoSlugInicial(), formulario({ slug: 'abc' })))).toBe(destino);
  });

  it('salão removido da sessão (não encontrado) → mensagem genérica de formulário', async () => {
    const s = await criarSalaoCompleto();
    await comoGestor(s);
    await c.query('UPDATE salao_slug SET atual = false WHERE salao_id = $1', [s.salaoId]);
    expect(await trocarSlugAcao(estadoSlugInicial(), formulario({ slug: 'qualquer-um' }))).toEqual({
      mensagem: M.formulario,
      sucesso: null,
      erros: {},
      valor: 'qualquer-um',
    });
  });
});
