import type pg from 'pg';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { criarServicoAcao, desativarServicoAcao, editarServicoAcao, reativarServicoAcao } from '@/app/painel/servicos/acoes';
import { ESTADO_INICIAL_FORMULARIO_SERVICO, ESTADO_INICIAL_SITUACAO } from '@/app/painel/servicos/estado';
import PaginaServico from '@/app/painel/servicos/[id]/page';
import PaginaNovoServico from '@/app/painel/servicos/novo/page';
import PaginaServicos from '@/app/painel/servicos/page';
import { MENSAGENS_SERVICO } from '@/server/servicos/tipos';

import { criarSessao } from '../../support/auth';
import { criarDoisSaloes, criarSalaoCompleto } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { conectar } from '../../support/sql';

import { UUID_INEXISTENTE, inserirProfissional, inserirServico, linhaServico, servicosPorNome, vincular, vinculosDe } from './apoio';

// D-014 T-6: páginas e casca de /painel/servicos com sessões reais no PostgreSQL. next/headers
// (cookies), next/navigation (redirect, notFound) e next/cache (revalidatePath) são substituídos (não
// é mock de banco). As páginas são renderizadas com renderToStaticMarkup. CA-1, CA-6, CA-7, CA-9,
// CA-10, CA-11 e CA-14 na borda Next.

const M = MENSAGENS_SERVICO;
const NBSP = ' ';

class Redirecionado extends Error {
  constructor(readonly destino: string) {
    super(`NEXT_REDIRECT ${destino}`);
  }
}
class NaoEncontradoNext extends Error {
  constructor() {
    super('NEXT_NOT_FOUND');
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
    throw new NaoEncontradoNext();
  },
  usePathname: () => null,
}));
vi.mock('next/cache', () => ({
  revalidatePath: (caminho: string) => {
    estadoNext.revalidados.push(caminho);
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

/** Erro lançado (redirect/notFound) ou falha se a promessa resolver. */
async function falhaDe(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    () => {
      throw new Error('esperava redirect ou notFound');
    },
    (e: unknown) => e,
  );
}
async function destinoDe(p: Promise<unknown>): Promise<string> {
  const e = await falhaDe(p);
  expect(e).toBeInstanceOf(Redirecionado);
  return (e as Redirecionado).destino;
}

const lista = async () => renderToStaticMarkup(await PaginaServicos());
const novo = async () => renderToStaticMarkup(await PaginaNovoServico());
const edicao = async (id: string) => renderToStaticMarkup(await PaginaServico({ params: Promise.resolve({ id }) }));

function formulario(campos: Record<string, string | Blob | string[]>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) {
    if (Array.isArray(v)) for (const x of v) f.append(k, x);
    else f.set(k, v);
  }
  return f;
}

describe('páginas: gestor', () => {
  it('CA-1/CA-10/CA-14: a lista mostra só os serviços de A, com preço, duração, situação e o aviso de não ofertável', async () => {
    const s = await criarSalaoCompleto();
    await inserirServico(c, s.salaoId, { nome: 'Sem ninguém', precoCentavos: 8000, duracaoMin: 45 });
    await comoGestor(s);
    const html = await lista();
    expect(html).toContain('<h1>Serviços</h1>');
    expect(html).toContain(`href="/painel/servicos/${s.servicos.ativos[0]}"`);
    expect(html).toContain(`href="/painel/servicos/${s.servicos.inativoId}"`);
    for (const texto of [`R$${NBSP}80,00`, '45 min', `R$${NBSP}90,00`, '1 h', 'Ativo', 'Inativo', M.semProfissional, 'Cadastrar serviço']) {
      expect(html, texto).toContain(texto);
    }
    expect(html).not.toContain(b.servicos.ativos[0]);
    expect(html).toContain('aria-current="page"');
  });

  it('a página de cadastro mostra o formulário com os profissionais ativos (nenhum marcado) e sem id oculto', async () => {
    await comoGestor(a);
    const html = await novo();
    expect(html).toContain('<h1>Cadastrar serviço</h1>');
    expect(html).toContain('name="preco"');
    expect(html).toContain('inputMode="decimal"');
    expect(html).toContain(`value="${a.profissional.profissionalId}"`);
    expect(html).not.toContain(`value="${a.profissionalInativoId}"`);
    expect(html).not.toContain('checked=""');
    expect(html).not.toContain('name="id"');
  });

  it('CA-6/CA-7: a edição mostra id oculto, valores, profissional vinculado marcado, inativo como "vínculo mantido" e o controle de situação', async () => {
    const s = await criarSalaoCompleto();
    const id = await inserirServico(c, s.salaoId, { nome: 'Pé e mão', precoCentavos: 123456, duracaoMin: 50 });
    await vincular(c, s.salaoId, id, s.profissional.profissionalId);
    await vincular(c, s.salaoId, id, s.profissionalInativoId);
    await comoGestor(s);
    const html = await edicao(id);
    expect(html).toContain('<h1>Pé e mão</h1>');
    expect(html).toContain(`name="id" value="${id}"`);
    expect(html).toContain('value="1.234,56"');
    expect(html).toContain('value="50"');
    expect(html).toMatch(new RegExp(`value="${s.profissional.profissionalId}"[^>]*checked=""|checked=""[^>]*value="${s.profissional.profissionalId}"`));
    expect(html).not.toMatch(new RegExp(`checked=""[^>]*value="${s.gestor.profissionalId}"|value="${s.gestor.profissionalId}"[^>]*checked=""`));
    expect(html).toContain('Inativo, vínculo mantido');
    expect(html).toContain('Desativar serviço');
    expect(html).not.toContain(M.semProfissional);

    const inativo = await edicao(s.servicos.inativoId);
    expect(inativo).toContain('Reativar serviço');

    const semNinguem = await inserirServico(c, s.salaoId, { nome: 'Sozinho' });
    expect(await edicao(semNinguem)).toContain(M.semProfissional);
  });

  it('CA-9: id de B, inexistente ou malformado → notFound', async () => {
    await comoGestor(a);
    for (const id of [b.servicos.ativos[0], UUID_INEXISTENTE, 'abc']) {
      expect(await falhaDe(edicao(id)), id).toBeInstanceOf(NaoEncontradoNext);
    }
  });
});

describe('CA-11: páginas para o profissional e sem sessão', () => {
  it('CA-11: profissional vê "Acesso negado" nas três páginas (403 antes do 404 na edição)', async () => {
    await comoProfissional(a);
    for (const html of [await lista(), await novo(), await edicao(a.servicos.ativos[0]), await edicao(b.servicos.ativos[0])]) {
      expect(html).toContain('Acesso negado');
      expect(html).not.toContain(a.servicos.nomes[0]);
    }
  });

  it('CA-11: sem cookie → redirect para /entrar?proximo=<rota>', async () => {
    expect(await destinoDe(lista())).toBe('/entrar?proximo=%2Fpainel%2Fservicos');
    expect(await destinoDe(novo())).toBe('/entrar?proximo=%2Fpainel%2Fservicos%2Fnovo');
    expect(await destinoDe(edicao('abc'))).toBe('/entrar?proximo=%2Fpainel%2Fservicos%2Fabc');
  });
});

describe('casca acoes.ts', () => {
  it('CA-1/CA-12: criar válido → grava com os vínculos e redireciona para a lista (revalidada); campos extras ignorados', async () => {
    await comoGestor(a);
    const destino = await destinoDe(
      criarServicoAcao(
        ESTADO_INICIAL_FORMULARIO_SERVICO,
        formulario({
          nome: 'Corte casca',
          preco: '80,00',
          duracao: '45',
          profissionais: [a.profissional.profissionalId, a.gestor.profissionalId!],
          ativo: 'false',
          salaoId: b.salaoId,
        }),
      ),
    );
    expect(destino).toBe('/painel/servicos');
    expect(estadoNext.revalidados).toEqual(['/painel/servicos']);
    const [criado] = await servicosPorNome(c, a.salaoId, 'Corte casca');
    expect(criado).toMatchObject({ preco_centavos: 8000, duracao_min: 45, ativo: true });
    expect(await vinculosDe(c, criado.id)).toEqual([a.profissional.profissionalId, a.gestor.profissionalId!].sort());
  });

  it('CA-5: criar inválido → erros por campo e valores aparados, cortados e preservados (inclusive as caixas)', async () => {
    await comoGestor(a);
    const r = await criarServicoAcao(
      ESTADO_INICIAL_FORMULARIO_SERVICO,
      formulario({ nome: '  A ', preco: `${'9'.repeat(30)}`, duracao: '123456', profissionais: [a.profissional.profissionalId] }),
    );
    expect(r).toEqual({
      mensagem: null,
      erros: { nome: M.nome, preco: M.preco, duracao: M.duracao },
      valores: { nome: 'A', preco: '9'.repeat(20), duracao: '1234', profissionais: [a.profissional.profissionalId] },
    });
    const r2 = await criarServicoAcao(ESTADO_INICIAL_FORMULARIO_SERVICO, formulario({ nome: new Blob(['x']), preco: '1', duracao: '5' }));
    expect(r2).toEqual({ mensagem: null, erros: { nome: M.nome }, valores: { nome: '', preco: '1', duracao: '5', profissionais: [] } });
    expect(await servicosPorNome(c, a.salaoId, 'A')).toEqual([]);
  });

  it('R-5/CA-6: editar sem nenhuma caixa marcada remove os vínculos com ativos; revalida lista e edição', async () => {
    const s = await criarSalaoCompleto();
    const extra = await inserirProfissional(c, s.salaoId, 'Extra');
    const id = await inserirServico(c, s.salaoId, { nome: 'Casca editar' });
    await vincular(c, s.salaoId, id, extra);
    await vincular(c, s.salaoId, id, s.profissionalInativoId);
    await comoGestor(s);
    expect(
      await destinoDe(editarServicoAcao(ESTADO_INICIAL_FORMULARIO_SERVICO, formulario({ id, nome: 'Renomeado', preco: '12,5', duracao: '15' }))),
    ).toBe('/painel/servicos');
    expect(estadoNext.revalidados).toEqual(['/painel/servicos', `/painel/servicos/${id}`]);
    expect(await linhaServico(c, id)).toMatchObject({ nome: 'Renomeado', preco_centavos: 1250, duracao_min: 15 });
    expect(await vinculosDe(c, id)).toEqual([s.profissionalInativoId]);
  });

  it('editar: inválido → erros; profissional de B → erro de campo; id de B → mensagem; profissional → acesso negado', async () => {
    await comoGestor(a);
    const id = a.servicos.ativos[1];
    const valido = { id, nome: 'Escova', preco: '55,00', duracao: '30' };
    expect((await editarServicoAcao(ESTADO_INICIAL_FORMULARIO_SERVICO, formulario({ ...valido, duracao: '7' }))).erros).toEqual({
      duracao: M.duracao,
    });
    expect(
      (await editarServicoAcao(ESTADO_INICIAL_FORMULARIO_SERVICO, formulario({ ...valido, profissionais: [b.profissional.profissionalId] }))).erros,
    ).toEqual({ profissionais: M.profissionais });
    expect(await editarServicoAcao(ESTADO_INICIAL_FORMULARIO_SERVICO, formulario({ ...valido, id: b.servicos.ativos[0] }))).toEqual({
      mensagem: M.naoEncontrado,
      erros: {},
      valores: { nome: 'Escova', preco: '55,00', duracao: '30', profissionais: [] },
    });
    await comoProfissional(a);
    expect((await editarServicoAcao(ESTADO_INICIAL_FORMULARIO_SERVICO, formulario(valido))).mensagem).toBe(M.acessoNegado);
    expect((await criarServicoAcao(ESTADO_INICIAL_FORMULARIO_SERVICO, formulario(valido))).mensagem).toBe(M.acessoNegado);
  });

  it('CA-3: desativar e reativar → estado com a mensagem e revalidação; reativar sem profissional avisa; id de B → erro', async () => {
    const s = await criarSalaoCompleto();
    const id = s.servicos.ativos[0];
    await comoGestor(s);
    expect(await desativarServicoAcao(ESTADO_INICIAL_SITUACAO, formulario({ id }))).toEqual({ variante: 'sucesso', mensagem: M.desativado });
    expect(estadoNext.revalidados).toEqual(['/painel/servicos', `/painel/servicos/${id}`]);
    expect((await linhaServico(c, id))!.ativo).toBe(false);
    expect(await reativarServicoAcao(ESTADO_INICIAL_SITUACAO, formulario({ id }))).toEqual({ variante: 'sucesso', mensagem: M.reativado });
    expect((await linhaServico(c, id))!.ativo).toBe(true);

    const sozinho = await inserirServico(c, s.salaoId, { nome: 'Sozinho', ativo: false });
    expect(await reativarServicoAcao(ESTADO_INICIAL_SITUACAO, formulario({ id: sozinho }))).toEqual({
      variante: 'sucesso',
      mensagem: `${M.reativado} ${M.semProfissional}`,
    });
    estadoNext.revalidados = [];
    expect(await desativarServicoAcao(ESTADO_INICIAL_SITUACAO, formulario({ id: b.servicos.ativos[0] }))).toEqual({
      variante: 'erro',
      mensagem: M.naoEncontrado,
    });
    expect(estadoNext.revalidados).toEqual([]);
  });

  it('nao_autenticado em toda ação → redirect para /entrar com a rota de origem', async () => {
    const id = a.servicos.ativos[0];
    const rotaId = encodeURIComponent(`/painel/servicos/${id}`);
    const dados = { nome: 'X', preco: '1', duracao: '5' };
    expect(await destinoDe(criarServicoAcao(ESTADO_INICIAL_FORMULARIO_SERVICO, formulario(dados)))).toBe(
      '/entrar?proximo=%2Fpainel%2Fservicos%2Fnovo',
    );
    expect(await destinoDe(editarServicoAcao(ESTADO_INICIAL_FORMULARIO_SERVICO, formulario({ ...dados, id })))).toBe(`/entrar?proximo=${rotaId}`);
    expect(await destinoDe(editarServicoAcao(ESTADO_INICIAL_FORMULARIO_SERVICO, formulario(dados)))).toBe('/entrar?proximo=%2Fpainel%2Fservicos');
    expect(await destinoDe(desativarServicoAcao(ESTADO_INICIAL_SITUACAO, formulario({ id })))).toBe(`/entrar?proximo=${rotaId}`);
    expect(await destinoDe(reativarServicoAcao(ESTADO_INICIAL_SITUACAO, formulario({ id })))).toBe(`/entrar?proximo=${rotaId}`);
  });

  it('profissional: desativar → mensagem de acesso negado, sem alterar o serviço', async () => {
    await comoProfissional(a);
    const id = a.servicos.ativos[0];
    expect(await desativarServicoAcao(ESTADO_INICIAL_SITUACAO, formulario({ id }))).toEqual({ variante: 'erro', mensagem: M.acessoNegado });
    expect((await linhaServico(c, id))!.ativo).toBe(true);
  });
});
