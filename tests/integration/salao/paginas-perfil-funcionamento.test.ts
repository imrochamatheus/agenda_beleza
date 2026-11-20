import type pg from 'pg';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { salvarFuncionamentoAcao } from '@/app/painel/configuracoes/funcionamento/acoes';
import { estadoFuncionamentoInicial } from '@/app/painel/configuracoes/funcionamento/estado';
import PaginaFuncionamento from '@/app/painel/configuracoes/funcionamento/page';
import PaginaConfiguracoes from '@/app/painel/configuracoes/page';
import { salvarPerfilAcao } from '@/app/painel/configuracoes/perfil/acoes';
import { estadoPerfilInicial } from '@/app/painel/configuracoes/perfil/estado';
import PaginaPerfil from '@/app/painel/configuracoes/perfil/page';
import { ROTAS } from '@/config/navegacao';
import { MENSAGENS_FUNCIONAMENTO as MF } from '@/server/salao/funcionamento-tipos';
import { MENSAGENS_PERFIL as MP, VALORES_PERFIL_VAZIOS } from '@/server/salao/perfil-tipos';

import { criarSessao, criarSuperAdmin } from '../../support/auth';
import { criarDoisSaloes, criarSalaoCompleto } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { conectar } from '../../support/sql';

import { MANAUS } from './apoio';
import { funcionamentoDe, linhaSalao } from './apoio-perfil';

// D-020 T-10: páginas e cascas de /painel/configuracoes/{perfil,funcionamento} com sessões reais no
// PostgreSQL. next/headers, next/navigation e next/cache são substituídos (não é mock de banco). Páginas
// renderizadas com renderToStaticMarkup. CA-1, CA-6, CA-7, CA-11, CA-13, CA-15 e CA-20.

class Redirecionado extends Error {
  constructor(readonly destino: string) {
    super(`NEXT_REDIRECT ${destino}`);
  }
}

const estadoNext = vi.hoisted(() => ({ cookie: undefined as string | undefined, revalidados: [] as [string, string | undefined][] }));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (nome: string) => (nome === 'ab_sessao' && estadoNext.cookie !== undefined ? { name: nome, value: estadoNext.cookie } : undefined),
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

const comoGestor = async (s: SalaoCompleto) => {
  estadoNext.cookie = (await criarSessao(s.gestor.usuarioId)).token;
};
const comoProfissional = async (s: SalaoCompleto) => {
  estadoNext.cookie = (await criarSessao(s.profissional.usuarioId)).token;
};

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

const paginaPerfil = async () => renderToStaticMarkup(await PaginaPerfil());
const paginaFuncionamento = async () => renderToStaticMarkup(await PaginaFuncionamento());

function formulario(campos: Record<string, string | string[]>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) {
    for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  }
  return f;
}

/** Atributos do input com o id, no HTML estático. */
const tagDe = (html: string, id: string) => html.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`))?.[0] ?? '';
const marcado = (html: string, id: string) => /\bchecked=""/.test(tagDe(html, id));
const itemAtual = (html: string) => html.match(/<a[^>]*aria-current="page"[^>]*>([^<]*)<\/a>/)?.[0] ?? '';

describe('CA-20: links e navegação', () => {
  it('/painel/configuracoes tem links para as duas subpáginas; nas subpáginas "Configurações" é o item atual', async () => {
    await comoGestor(a);
    const html = renderToStaticMarkup(await PaginaConfiguracoes());
    expect(html).toContain(`href="${ROTAS.configuracoesPerfil}"`);
    expect(html).toContain(`href="${ROTAS.configuracoesFuncionamento}"`);
    expect(html).toContain('aria-label="Outras configurações"');
    for (const h of [await paginaPerfil(), await paginaFuncionamento()]) {
      const atual = itemAtual(h);
      expect(atual).toContain(`href="${ROTAS.configuracoes}"`);
      expect(atual).toContain('Configurações');
      expect(h).toContain(`href="${ROTAS.configuracoes}"`);
    }
  });
});

describe('acesso (CA-1, CA-13)', () => {
  it('profissional vê "Acesso negado" sem dados nas duas páginas', async () => {
    await comoProfissional(a);
    for (const html of [await paginaPerfil(), await paginaFuncionamento()]) {
      expect(html).toContain('Acesso negado');
      expect(html).not.toContain(a.nome);
      expect(html).not.toContain('name="descricao"');
      expect(html).not.toContain('name="modo"');
    }
  });

  it('gestor com perfil de profissional tem acesso; super admin vê "Acesso negado"', async () => {
    expect(a.gestor.profissionalId).not.toBeNull();
    await comoGestor(a);
    expect(await paginaPerfil()).toContain('<h1>Perfil público</h1>');
    expect(await paginaFuncionamento()).toContain('<h1>Horário de funcionamento</h1>');
    estadoNext.cookie = (await criarSuperAdmin({ totpVerificado: true })).credencial?.token;
    expect(await paginaPerfil()).toContain('Acesso negado');
    expect(await paginaFuncionamento()).toContain('Acesso negado');
  });

  it('sem sessão → /entrar?proximo= com a rota codificada (páginas e cascas)', async () => {
    expect(await destinoDe(PaginaPerfil())).toBe('/entrar?proximo=%2Fpainel%2Fconfiguracoes%2Fperfil');
    expect(await destinoDe(PaginaFuncionamento())).toBe('/entrar?proximo=%2Fpainel%2Fconfiguracoes%2Ffuncionamento');
    expect(await destinoDe(salvarPerfilAcao(estadoPerfilInicial(), formulario({})))).toBe('/entrar?proximo=%2Fpainel%2Fconfiguracoes%2Fperfil');
    expect(await destinoDe(salvarFuncionamentoAcao(estadoFuncionamentoInicial({ definido: false }), formulario({ modo: 'informar' })))).toBe(
      '/entrar?proximo=%2Fpainel%2Fconfiguracoes%2Ffuncionamento',
    );
  });

  it('casca com profissional → mensagem de acesso negado e valores digitados', async () => {
    await comoProfissional(a);
    const r = await salvarPerfilAcao(estadoPerfilInicial(), formulario({ instagram: 'x' }));
    expect(r).toMatchObject({ mensagem: MP.acessoNegado, sucesso: null, valores: { instagram: 'x' } });
    const f = await salvarFuncionamentoAcao(estadoFuncionamentoInicial({ definido: false }), formulario({ modo: 'informar', 'inicio-1-0': '09:00' }));
    expect(f).toMatchObject({ mensagem: MF.acessoNegado, modo: 'informar' });
    expect(f.valores[1][0]).toEqual({ inicio: '09:00', fim: '' });
  });
});

describe('perfil: página e casca', () => {
  it('casca: inválido devolve erros com os valores e as caixas; salaoId de B descartado; nada gravado', async () => {
    const s = await criarSalaoCompleto();
    await comoGestor(s);
    const antes = await linhaSalao(c, s.salaoId);
    const bAntes = await linhaSalao(c, b.salaoId);
    const r = await salvarPerfilAcao(estadoPerfilInicial(), formulario({ cep: '123', meiosPagamento: ['pix', 'cheque'], salaoId: b.salaoId }));
    expect(r.erros).toMatchObject({ cep: MP.cep, meiosPagamento: MP.lista });
    expect(r.valores).toMatchObject({ cep: '123', meiosPagamento: ['pix', 'cheque'] });
    expect(estadoNext.revalidados).toEqual([]);
    expect(await linhaSalao(c, s.salaoId)).toEqual(antes);
    expect(await linhaSalao(c, b.salaoId)).toEqual(bAntes);
  });

  it('casca: sucesso revalida e devolve os valores normalizados; CA-15: a página mostra as caixas e ignora cheque', async () => {
    const s = await criarSalaoCompleto();
    await comoGestor(s);
    const r = await salvarPerfilAcao(estadoPerfilInicial(), formulario({ telefone: '11987654321', meiosPagamento: ['pix', 'dinheiro', 'pix'], comodidades: ['wifi'] }));
    expect(r).toEqual({
      mensagem: null,
      sucesso: MP.salvo,
      erros: {},
      valores: { ...VALORES_PERFIL_VAZIOS, telefone: '(11) 98765-4321', meiosPagamento: ['dinheiro', 'pix'], comodidades: ['wifi'] },
    });
    expect(estadoNext.revalidados).toEqual([[ROTAS.configuracoesPerfil, undefined]]);
    await c.query(`UPDATE salao SET meios_pagamento = array_append(meios_pagamento, 'cheque') WHERE id = $1`, [s.salaoId]);
    const html = await paginaPerfil();
    expect(marcado(html, 'perfil-meiosPagamento')).toBe(true);
    expect(marcado(html, 'perfil-meiosPagamento-pix')).toBe(true);
    expect(marcado(html, 'perfil-meiosPagamento-cartao_credito')).toBe(false);
    expect(html).not.toContain('cheque');
    expect(tagDe(html, 'perfil-telefone')).toContain('value="(11) 98765-4321"');
    expect(html).toContain(MP.ajudaPublico);
  });

  it('a página de A não mostra dados de B', async () => {
    const t = await criarDoisSaloes();
    await comoGestor(t.b);
    await salvarPerfilAcao(estadoPerfilInicial(), formulario({ instagram: 'perfil.de.b' }));
    await comoGestor(t.a);
    expect(await paginaPerfil()).not.toContain('perfil.de.b');
  });
});

describe('funcionamento: página e casca', () => {
  it('CA-6: salão novo abre com "Não informar" selecionado e o aviso de não informado', async () => {
    const s = await criarSalaoCompleto();
    await comoGestor(s);
    const html = await paginaFuncionamento();
    expect(marcado(html, 'funcionamento-modo')).toBe(true);
    expect(marcado(html, 'funcionamento-modo-informar')).toBe(false);
    expect(html).toContain(MF.naoInformado);
  });

  it('CA-7: informar todos vazios → "Fechado" nos 7 dias e o aviso de sem horários', async () => {
    const s = await criarSalaoCompleto();
    await comoGestor(s);
    const r = await salvarFuncionamentoAcao(estadoFuncionamentoInicial({ definido: false }), formulario({ modo: 'informar' }));
    expect(r).toMatchObject({ sucesso: MF.salvo, modo: 'informar', erros: {} });
    expect(estadoNext.revalidados).toEqual([[ROTAS.configuracoesFuncionamento, undefined]]);
    const html = await paginaFuncionamento();
    expect(html.match(new RegExp(`>${MF.fechado}<`, 'g'))).toHaveLength(7);
    expect(html).toContain(MF.todosFechados);
    expect(marcado(html, 'funcionamento-modo-informar')).toBe(true);
  });

  it('CA-11: Manaus 09:00–12:00 → 540 e a página exibe 09:00', async () => {
    const s = await criarSalaoCompleto({ salao: { fuso: MANAUS } });
    await comoGestor(s);
    const r = await salvarFuncionamentoAcao(
      estadoFuncionamentoInicial({ definido: false }),
      formulario({ modo: 'informar', 'inicio-1-0': '9:00', 'fim-1-0': '12:00', salaoId: b.salaoId }),
    );
    expect(r.valores[1][0]).toEqual({ inicio: '09:00', fim: '12:00' });
    expect(r.funcionamento).toMatchObject({ definido: true });
    expect((await funcionamentoDe(c, s.salaoId)).map((l) => [l.dia_semana, l.inicio_min, l.fim_min])).toEqual([[1, 540, 720]]);
    const html = await paginaFuncionamento();
    expect(tagDe(html, 'funcionamento-1-0-inicio')).toContain('value="09:00"');
    expect(html).toContain('09:00–12:00');
    expect(html).not.toContain(MF.naoInformado);
    expect(await funcionamentoDe(c, b.salaoId)).toEqual([]);
  });

  it('casca: inválido devolve erros por dia e os valores; não informar devolve linhas vazias', async () => {
    const s = await criarSalaoCompleto();
    await comoGestor(s);
    const antes = await linhaSalao(c, s.salaoId);
    const r = await salvarFuncionamentoAcao(estadoFuncionamentoInicial({ definido: false }), formulario({ modo: 'informar', 'inicio-3-0': '22:00', 'fim-3-0': '02:00' }));
    expect(r.erros).toEqual({ dias: { 3: { intervalos: { 0: { intervalo: MF.ordem } } } } });
    expect(r.valores[3][0]).toEqual({ inicio: '22:00', fim: '02:00' });
    expect(r.modo).toBe('informar');
    expect(await linhaSalao(c, s.salaoId)).toEqual(antes);
    const semModo = await salvarFuncionamentoAcao(estadoFuncionamentoInicial({ definido: false }), formulario({}));
    expect(semModo.erros).toEqual({ modo: MF.modo });
    const nao = await salvarFuncionamentoAcao(estadoFuncionamentoInicial({ definido: false }), formulario({ modo: 'nao_informar', 'inicio-1-0': 'xx' }));
    expect(nao).toMatchObject({ sucesso: MF.salvo, modo: 'nao_informar', funcionamento: { definido: false } });
    expect(nao.valores[1][0]).toEqual({ inicio: '', fim: '' });
  });
});
