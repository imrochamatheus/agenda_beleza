import type pg from 'pg';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  criarProfissionalAcao,
  desativarProfissionalAcao,
  editarProfissionalAcao,
  euTambemAtendoAcao,
  reativarProfissionalAcao,
} from '@/app/painel/profissionais/acoes';
import { ESTADO_INICIAL_FORMULARIO } from '@/app/painel/profissionais/estado';
import PaginaProfissional from '@/app/painel/profissionais/[id]/page';
import PaginaNovoProfissional from '@/app/painel/profissionais/novo/page';
import PaginaProfissionais from '@/app/painel/profissionais/page';
import { MENSAGENS_PROFISSIONAL, ROTULO_CLIENTE_REMOVIDA } from '@/server/profissionais/tipos';

import { criarSessao } from '../../support/auth';
import { criarDoisSaloes, criarSalaoCompleto } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { conectar } from '../../support/sql';

import { cancelarReservasDoSalao, linhaProfissional } from './apoio';

// D-013 T-6: páginas e casca de /painel/profissionais com sessões reais no PostgreSQL. next/headers
// (cookies), next/navigation (redirect, notFound) e next/cache (revalidatePath) são substituídos (não
// é mock de banco). As páginas são renderizadas com renderToStaticMarkup. CA-1, CA-3, CA-6, CA-9,
// CA-10 e CA-11 na borda Next.

const M = MENSAGENS_PROFISSIONAL;

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

const lista = async () => renderToStaticMarkup(await PaginaProfissionais());
const novo = async () => renderToStaticMarkup(await PaginaNovoProfissional());
const edicao = async (id: string) => renderToStaticMarkup(await PaginaProfissional({ params: Promise.resolve({ id }) }));

function formulario(campos: Record<string, string | Blob>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
}

describe('páginas: gestor', () => {
  it('CA-10: a lista mostra só os profissionais de A, com estado e acesso; sem "Eu também atendo" (já atende)', async () => {
    await comoGestor(a);
    const html = await lista();
    expect(html).toContain('<h1>Profissionais</h1>');
    expect(html).toContain(`href="/painel/profissionais/${a.profissional.profissionalId}"`);
    expect(html).toContain(`href="/painel/profissionais/${a.profissionalInativoId}"`);
    expect(html).not.toContain(b.profissional.profissionalId);
    expect(html).not.toContain(b.nome);
    for (const texto of ['Ativo', 'Inativo', 'Você', 'Com acesso', 'Sem acesso', 'Cadastrar profissional']) {
      expect(html, texto).toContain(texto);
    }
    expect(html).toContain('aria-current="page"');
    expect(html).not.toContain('Eu também atendo');
  });

  it('gestor sem perfil vê "Eu também atendo"; a página de cadastro mostra o formulário', async () => {
    const s = await criarSalaoCompleto({ gestor: { comPerfil: false } });
    await comoGestor(s);
    expect(await lista()).toContain('Eu também atendo');
    const html = await novo();
    expect(html).toContain('<h1>Cadastrar profissional</h1>');
    expect(html).toContain('name="nome"');
    expect(html).not.toContain('name="id"');
  });

  it('a edição mostra o formulário com id oculto, o acesso e o controle de ativação', async () => {
    await comoGestor(a);
    const html = await edicao(a.profissional.profissionalId);
    expect(html).toContain(`value="${a.profissional.profissionalId}"`);
    expect(html).toContain('Acesso ao painel');
    expect(html).toContain(a.profissional.email);
    expect(html).toContain('readOnly=""');
    expect(html).toContain('Desativar');
    const inativo = await edicao(a.profissionalInativoId);
    expect(inativo).toContain('Reativar');
    expect(inativo).toContain('Sem acesso ao painel');
    const proprio = await edicao(a.gestor.profissionalId!);
    expect(proprio).toContain('Este é o seu perfil de profissional');
  });

  it('CA-9: id de B, inexistente ou malformado → notFound', async () => {
    await comoGestor(a);
    for (const id of [b.profissional.profissionalId, '00000000-0000-4000-8000-000000000000', 'abc']) {
      expect(await falhaDe(edicao(id)), id).toBeInstanceOf(NaoEncontradoNext);
    }
  });
});

describe('CA-11: páginas para o profissional e sem sessão', () => {
  it('CA-11: profissional vê "Acesso negado" nas três páginas (403 antes do 404 na edição)', async () => {
    await comoProfissional(a);
    for (const html of [await lista(), await novo(), await edicao(a.profissional.profissionalId), await edicao(b.profissional.profissionalId)]) {
      expect(html).toContain('Acesso negado');
      expect(html).not.toContain(a.profissional.nome);
    }
  });

  it('CA-11: sem cookie → redirect para /entrar?proximo=<rota>', async () => {
    expect(await destinoDe(lista())).toBe('/entrar?proximo=%2Fpainel%2Fprofissionais');
    expect(await destinoDe(novo())).toBe('/entrar?proximo=%2Fpainel%2Fprofissionais%2Fnovo');
    expect(await destinoDe(edicao('abc'))).toBe('/entrar?proximo=%2Fpainel%2Fprofissionais%2Fabc');
  });
});

describe('casca acoes.ts', () => {
  it('CA-1: criar válido → grava e redireciona para a lista (revalidada); campos extras ignorados', async () => {
    await comoGestor(a);
    const destino = await destinoDe(
      criarProfissionalAcao(ESTADO_INICIAL_FORMULARIO, formulario({ nome: 'Ana Casca', email: '', usuarioId: a.gestor.usuarioId, ativo: 'false' })),
    );
    expect(destino).toBe('/painel/profissionais');
    expect(estadoNext.revalidados).toEqual(['/painel/profissionais']);
    const { rows } = await c.query(`SELECT usuario_id, ativo, email FROM profissional WHERE salao_id = $1 AND nome = 'Ana Casca'`, [a.salaoId]);
    expect(rows).toEqual([{ usuario_id: null, ativo: true, email: null }]);
  });

  it('CA-12: criar inválido → erros por campo e valores aparados e cortados; arquivo no lugar do texto vira ausente', async () => {
    await comoGestor(a);
    const r = await criarProfissionalAcao(ESTADO_INICIAL_FORMULARIO, formulario({ nome: `  A  `, email: `${'x'.repeat(300)}@` }));
    expect(r.mensagem).toBeNull();
    expect(r.erros).toEqual({ nome: M.nome, email: M.email });
    expect(r.valores.nome).toBe('A');
    expect(r.valores.email).toHaveLength(254);
    const r2 = await criarProfissionalAcao(ESTADO_INICIAL_FORMULARIO, formulario({ nome: new Blob(['x']) }));
    expect(r2).toEqual({ mensagem: null, erros: { nome: M.nome }, valores: { nome: '', email: '' } });
  });

  it('editar: válido → lista (revalida lista e edição); inválido → erros; 404 e 403 → mensagem', async () => {
    await comoGestor(a);
    const id = a.profissionalInativoId;
    expect(await destinoDe(editarProfissionalAcao(ESTADO_INICIAL_FORMULARIO, formulario({ id, nome: 'Renomeada', email: 'r@exemplo.com' })))).toBe(
      '/painel/profissionais',
    );
    expect(estadoNext.revalidados).toEqual(['/painel/profissionais', `/painel/profissionais/${id}`]);
    expect(await linhaProfissional(c, id)).toMatchObject({ nome: 'Renomeada', email: 'r@exemplo.com' });

    expect((await editarProfissionalAcao(ESTADO_INICIAL_FORMULARIO, formulario({ id, nome: 'R' }))).erros).toEqual({ nome: M.nome });
    expect(await editarProfissionalAcao(ESTADO_INICIAL_FORMULARIO, formulario({ id: b.profissional.profissionalId, nome: 'Invasora' }))).toEqual({
      mensagem: M.naoEncontrado,
      erros: {},
      valores: { nome: 'Invasora', email: '' },
    });
    await comoProfissional(a);
    expect((await editarProfissionalAcao(ESTADO_INICIAL_FORMULARIO, formulario({ id, nome: 'Outra' }))).mensagem).toBe(M.acessoNegado);
    expect((await criarProfissionalAcao(ESTADO_INICIAL_FORMULARIO, formulario({ nome: 'Outra' }))).mensagem).toBe(M.acessoNegado);
  });

  it('CA-3: desativar recusado → estado com as reservas; desativado → revalida; reativar → revalida', async () => {
    const s = await criarSalaoCompleto();
    await comoGestor(s);
    const r = await desativarProfissionalAcao(s.profissional.profissionalId);
    // D-050 RN-38: a reserva da fábrica tem 2 itens do profissional → uma linha por item.
    expect(r).toMatchObject({
      status: 'recusado',
      reservas: [
        { id: s.reserva.id, cliente: s.clientes.nomeAtiva, servicos: [s.servicos.nomes[0]] },
        { id: s.reserva.id, cliente: s.clientes.nomeAtiva, servicos: [s.servicos.nomes[1]] },
      ],
    });
    expect(estadoNext.revalidados).toEqual([]);
    expect(ROTULO_CLIENTE_REMOVIDA).toBe('cliente removida');

    await cancelarReservasDoSalao(c, s.salaoId);
    expect(await desativarProfissionalAcao(s.profissional.profissionalId)).toEqual({ status: 'desativado' });
    expect(estadoNext.revalidados).toEqual(['/painel/profissionais', `/painel/profissionais/${s.profissional.profissionalId}`]);
    expect((await linhaProfissional(c, s.profissional.profissionalId))!.ativo).toBe(false);

    estadoNext.revalidados = [];
    await reativarProfissionalAcao(formulario({ id: s.profissional.profissionalId }));
    expect(estadoNext.revalidados).toEqual(['/painel/profissionais', `/painel/profissionais/${s.profissional.profissionalId}`]);
    expect((await linhaProfissional(c, s.profissional.profissionalId))!.ativo).toBe(true);

    expect(await desativarProfissionalAcao(b.profissional.profissionalId)).toEqual({ status: 'erro', mensagem: M.naoEncontrado });
  });

  it('CA-6: o gestor desativa o próprio perfil e continua acessando a lista; "Eu também atendo" reativa', async () => {
    const s = await criarSalaoCompleto();
    await comoGestor(s);
    expect(await desativarProfissionalAcao(s.gestor.profissionalId!)).toEqual({ status: 'desativado' });
    const html = await lista();
    expect(html).toContain('Eu também atendo');
    expect(await euTambemAtendoAcao()).toEqual({ variante: 'sucesso', mensagem: M.perfilAtivado });
    expect(estadoNext.revalidados).toContain('/painel/profissionais');
    expect(await euTambemAtendoAcao()).toEqual({ variante: 'info', mensagem: M.jaAtende });
    expect(await lista()).not.toContain('Eu também atendo');
  });

  it('nao_autenticado em toda ação → redirect para /entrar com a rota de origem', async () => {
    const id = a.profissional.profissionalId;
    const rotaId = encodeURIComponent(`/painel/profissionais/${id}`);
    expect(await destinoDe(criarProfissionalAcao(ESTADO_INICIAL_FORMULARIO, formulario({ nome: 'X' })))).toBe(
      '/entrar?proximo=%2Fpainel%2Fprofissionais%2Fnovo',
    );
    expect(await destinoDe(editarProfissionalAcao(ESTADO_INICIAL_FORMULARIO, formulario({ id, nome: 'X' })))).toBe(`/entrar?proximo=${rotaId}`);
    expect(await destinoDe(editarProfissionalAcao(ESTADO_INICIAL_FORMULARIO, formulario({ nome: 'X' })))).toBe(
      '/entrar?proximo=%2Fpainel%2Fprofissionais',
    );
    expect(await destinoDe(desativarProfissionalAcao(id))).toBe(`/entrar?proximo=${rotaId}`);
    expect(await destinoDe(reativarProfissionalAcao(formulario({ id })))).toBe(`/entrar?proximo=${rotaId}`);
    expect(await destinoDe(euTambemAtendoAcao())).toBe('/entrar?proximo=%2Fpainel%2Fprofissionais');
  });

  it('profissional: "Eu também atendo" e desativar devolvem a mensagem de acesso negado; reativar só revalida', async () => {
    await comoProfissional(a);
    expect(await euTambemAtendoAcao()).toEqual({ variante: 'erro', mensagem: M.acessoNegado });
    expect(await desativarProfissionalAcao(a.profissional.profissionalId)).toEqual({ status: 'erro', mensagem: M.acessoNegado });
    await reativarProfissionalAcao(formulario({ id: a.profissionalInativoId }));
    expect((await linhaProfissional(c, a.profissionalInativoId))!.ativo).toBe(false);
  });
});
