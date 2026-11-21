import type pg from 'pg';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { editarClienteAcao } from '@/app/painel/clientes/acoes';
import PaginaDetalhe from '@/app/painel/clientes/[id]/page';
import { estadoInicial } from '@/app/painel/clientes/estado';
import PaginaClientes from '@/app/painel/clientes/page';
import { ROTAS } from '@/config/navegacao';
import { MENSAGENS_CLIENTE } from '@/server/clientes/tipos';

import { criarSessao, criarSuperAdmin } from '../../support/auth';
import { criarDoisSaloes, criarSalaoCompleto } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { conectar } from '../../support/sql';

import { UUID_INEXISTENTE, anonimizarPorSql, inserirCliente, linhaCliente } from './apoio';

// D-022 T-4/T-5: páginas /painel/clientes e /painel/clientes/[id] e a casca de ações com sessões reais no
// PostgreSQL. CA-4, CA-5, CA-7, CA-10, CA-11, CA-15, CA-16. next/headers (cookies), next/navigation
// (redirect, notFound) e next/cache (revalidatePath) são substituídos (não é mock de banco).

class Redirecionado extends Error {
  constructor(readonly destino: string) {
    super(`NEXT_REDIRECT ${destino}`);
  }
}

const estadoNext = vi.hoisted(() => ({ cookie: undefined as string | undefined, revalidados: [] as string[] }));

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

const lista = async (params: Record<string, string> = {}) => renderToStaticMarkup(await PaginaClientes({ searchParams: Promise.resolve(params) }));
const detalhe = async (id: string) => renderToStaticMarkup(await PaginaDetalhe({ params: Promise.resolve({ id }) }));

function fd(campos: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
}

describe('CA-5: acesso às páginas', () => {
  it('profissional vê "Acesso negado" na lista e no detalhe, sem dados da cliente', async () => {
    await comoProfissional(a);
    for (const html of [await lista(), await detalhe(a.clientes.ativaId)]) {
      expect(html).toContain('Acesso negado');
      expect(html).not.toContain(a.clientes.nomeAtiva);
      expect(html).not.toContain('name="telefone"');
    }
  });

  it('sem sessão redireciona para /entrar?proximo=; super admin recebe "Acesso negado"', async () => {
    expect(await destinoDe(PaginaClientes({ searchParams: Promise.resolve({}) }))).toBe('/entrar?proximo=%2Fpainel%2Fclientes');
    expect(await destinoDe(PaginaDetalhe({ params: Promise.resolve({ id: a.clientes.ativaId }) }))).toBe(
      `/entrar?proximo=${encodeURIComponent(ROTAS.cliente(a.clientes.ativaId))}`,
    );
    estadoNext.cookie = (await criarSuperAdmin({ totpVerificado: true })).credencial?.token;
    expect(await lista()).toContain('Acesso negado');
  });

  it('o item "Clientes" não existe na navegação do profissional (só do gestor)', async () => {
    const { NAVEGACAO_PAINEL } = await import('@/config/navegacao');
    expect(NAVEGACAO_PAINEL.profissional.some((i) => i.chave === 'clientes')).toBe(false);
    expect(NAVEGACAO_PAINEL.gestor.some((i) => i.chave === 'clientes')).toBe(true);
  });
});

describe('lista e detalhe do gestor (CA-4, CA-7)', () => {
  it('a lista mostra só as clientes do salão, com telefone formatado e link; busca por GET', async () => {
    await comoGestor(a);
    const html = await lista();
    expect(html).toContain('<h1>Clientes</h1>');
    expect(html).toContain(a.clientes.nomeAtiva);
    expect(html).toContain(`href="${ROTAS.cliente(a.clientes.ativaId)}"`);
    expect(html).not.toContain(b.clientes.nomeAtiva);
    expect(html).not.toContain(a.clientes.anonimizadaId);
    expect(html).toContain('role="search"');
    expect(await lista({ q: 'zzzz-nao-existe' })).toContain(MENSAGENS_CLIENTE.nenhumaEncontrada);
    expect(await lista({ q: a.clientes.nomeAtiva.toUpperCase() })).toContain(a.clientes.nomeAtiva);
  });

  it('o detalhe mostra dados, formulário e o histórico; cliente de B, inexistente e id inválido → 404', async () => {
    await comoGestor(a);
    const html = await detalhe(a.clientes.ativaId);
    expect(html).toContain(a.clientes.nomeAtiva);
    expect(html).toContain('name="telefone"');
    expect(html).toContain('Agendamentos');
    expect(html).toContain(a.servicos.nomes[0]);
    for (const id of [b.clientes.ativaId, UUID_INEXISTENTE, 'nao-uuid']) {
      await expect(detalhe(id), id).rejects.toThrow('NEXT_NOT_FOUND');
    }
  });

  it('anonimizada: "Cliente removida", histórico e nenhum formulário', async () => {
    const s = await criarSalaoCompleto();
    await comoGestor(s);
    const html = await detalhe(s.clientes.anonimizadaId);
    expect(html).toContain('Cliente removida');
    expect(html).toContain(MENSAGENS_CLIENTE.semAgendamentos);
    expect(html).not.toContain('name="nome"');
    expect(html).not.toContain('name="telefone"');
    expect(html).not.toContain('Salvar alterações');
  });
});

describe('casca editarClienteAcao (CA-10, CA-11, CA-15)', () => {
  it('sucesso: estado com os valores normalizados, revalida lista e detalhe; sem alteração → mensagem própria', async () => {
    const s = await criarSalaoCompleto({ cliente: { nome: 'Lia', telefoneE164: '+5511966660001' } });
    await comoGestor(s);
    const id = s.clientes.ativaId;
    const r = await editarClienteAcao(estadoInicial({ nome: '', telefone: '' }), fd({ id, nome: '  Lia   Souza ', telefone: '11 96666-0002' }));
    expect(r).toEqual({
      mensagem: null,
      sucesso: MENSAGENS_CLIENTE.salva,
      erros: {},
      existente: null,
      valores: { nome: 'Lia Souza', telefone: '(11) 96666-0002' },
    });
    expect(estadoNext.revalidados).toEqual([ROTAS.clientes, ROTAS.cliente(id)]);
    expect(await linhaCliente(c, id)).toMatchObject({ nome: 'Lia Souza', telefone_e164: '+5511966660002' });
    estadoNext.revalidados = [];
    const igual = await editarClienteAcao(estadoInicial({ nome: '', telefone: '' }), fd({ id, nome: 'Lia Souza', telefone: '(11) 96666-0002' }));
    expect(igual).toMatchObject({ sucesso: MENSAGENS_CLIENTE.semAlteracao, erros: {} });
    expect(estadoNext.revalidados).toEqual([]);
  });

  it('inválido: erros juntos e valores digitados; salaoId de B descartado; nada gravado', async () => {
    const s = await criarSalaoCompleto();
    await comoGestor(s);
    const antes = await linhaCliente(c, s.clientes.ativaId);
    const bAntes = await linhaCliente(c, b.clientes.ativaId);
    const r = await editarClienteAcao(estadoInicial({ nome: '', telefone: '' }), fd({ id: s.clientes.ativaId, nome: 'A', telefone: 'abc', salaoId: b.salaoId }));
    expect(r).toEqual({
      mensagem: null,
      sucesso: null,
      erros: { telefone: MENSAGENS_CLIENTE.telefone, nome: MENSAGENS_CLIENTE.nomeTamanho },
      existente: null,
      valores: { nome: 'A', telefone: 'abc' },
    });
    expect(await linhaCliente(c, s.clientes.ativaId)).toEqual(antes);
    expect(await linhaCliente(c, b.clientes.ativaId)).toEqual(bAntes);
  });

  it('telefone em uso: erro no telefone, a cliente existente no estado e valores preservados', async () => {
    const s = await criarSalaoCompleto();
    await comoGestor(s);
    const yId = await inserirCliente(c, s.salaoId, 'Yara', '+5511966660010');
    const r = await editarClienteAcao(estadoInicial({ nome: '', telefone: '' }), fd({ id: s.clientes.ativaId, nome: 'Novo Nome', telefone: '(11) 96666-0010' }));
    expect(r).toEqual({
      mensagem: null,
      sucesso: null,
      erros: { telefone: MENSAGENS_CLIENTE.telefoneEmUso },
      existente: { id: yId, nome: 'Yara' },
      valores: { nome: 'Novo Nome', telefone: '(11) 96666-0010' },
    });
  });

  it('profissional → acesso negado; id de B/anonimizada/ausente → não encontrada; sem sessão → /entrar; valores preservados', async () => {
    const s = await criarSalaoCompleto();
    const valores = { nome: 'Fulana', telefone: '11987654321' };
    await comoProfissional(s);
    expect(await editarClienteAcao(estadoInicial(valores), fd({ id: s.clientes.ativaId, ...valores }))).toEqual({
      ...estadoInicial(valores),
      mensagem: MENSAGENS_CLIENTE.acessoNegado,
    });
    await comoGestor(s);
    for (const id of [b.clientes.ativaId, s.clientes.anonimizadaId, '']) {
      expect(await editarClienteAcao(estadoInicial(valores), fd({ id, ...valores })), id).toEqual({
        ...estadoInicial(valores),
        mensagem: MENSAGENS_CLIENTE.naoEncontrado,
      });
    }
    estadoNext.cookie = undefined;
    expect(await destinoDe(editarClienteAcao(estadoInicial(valores), fd({ id: s.clientes.ativaId, ...valores })))).toBe(
      `/entrar?proximo=${encodeURIComponent(ROTAS.cliente(s.clientes.ativaId))}`,
    );
    expect(await destinoDe(editarClienteAcao(estadoInicial(valores), fd(valores)))).toBe('/entrar?proximo=%2Fpainel%2Fclientes');
  });

  it('o número de uma cliente anonimizada fica livre para a edição', async () => {
    const s = await criarSalaoCompleto();
    await comoGestor(s);
    const zId = await inserirCliente(c, s.salaoId, 'Zilda', '+5511966660020');
    await anonimizarPorSql(c, zId);
    const r = await editarClienteAcao(estadoInicial({ nome: '', telefone: '' }), fd({ id: s.clientes.ativaId, nome: 'Nova Dona', telefone: '(11) 96666-0020' }));
    expect(r).toMatchObject({ sucesso: MENSAGENS_CLIENTE.salva, valores: { telefone: '(11) 96666-0020' } });
  });
});
