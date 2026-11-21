import type pg from 'pg';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { excluirClienteAcao } from '@/app/painel/clientes/acoes';
import PaginaDetalhe from '@/app/painel/clientes/[id]/page';
import PaginaExcluir from '@/app/painel/clientes/[id]/excluir/page';
import { ROTAS } from '@/config/navegacao';
import { MENSAGENS_EXCLUSAO, TEXTO_CONFIRMACAO_EXCLUSAO } from '@/server/clientes/tipos';

import { criarSessao } from '../../support/auth';
import { criarDoisSaloes } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { conectar } from '../../support/sql';

import { UUID_INEXISTENTE, inserirCliente, linhaCliente } from './apoio';

// D-031 T-3 (CA-9, CA-13): página de confirmação, ação-casca e detalhe com sessões reais no PostgreSQL.
// next/headers, next/navigation e next/cache são substituídos (não é mock de banco).

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

const excluir = async (id: string) => renderToStaticMarkup(await PaginaExcluir({ params: Promise.resolve({ id }) }));
const detalhe = async (id: string, exclusao?: string) =>
  renderToStaticMarkup(await PaginaDetalhe({ params: Promise.resolve({ id }), searchParams: Promise.resolve(exclusao ? { exclusao } : {}) }));
const fd = (clienteId?: string) => {
  const f = new FormData();
  if (clienteId !== undefined) f.set('clienteId', clienteId);
  return f;
};
const novaCliente = (s: SalaoCompleto, nome: string) => inserirCliente(c, s.salaoId, nome);

describe('CA-13: página de confirmação (GET não altera nada)', () => {
  it('mostra o nome, o que acontece, irreversível, Confirmar e Cancelar; a cliente continua identificada', async () => {
    const id = await novaCliente(a, 'Maria da Confirmação');
    await comoGestor(a);
    const antes = await linhaCliente(c, id);
    const html = await excluir(id);
    expect(html).toContain('Maria da Confirmação');
    for (const t of TEXTO_CONFIRMACAO_EXCLUSAO.oQueAcontece) expect(html).toContain(t.replace(/"/g, '&quot;'));
    expect(html).toContain('name="clienteId"');
    expect(html).toContain(TEXTO_CONFIRMACAO_EXCLUSAO.confirmar);
    expect(html).toMatch(new RegExp(`href="${ROTAS.cliente(id)}"[^>]*>${TEXTO_CONFIRMACAO_EXCLUSAO.cancelar}`));
    expect(await linhaCliente(c, id)).toEqual(antes);
  });

  it('o detalhe da cliente ativa tem o link "Excluir cliente"; o da anonimizada não tem', async () => {
    const id = await novaCliente(a, 'Com Link');
    await comoGestor(a);
    expect(await detalhe(id)).toContain(`href="${ROTAS.excluirCliente(id)}"`);
    expect(await detalhe(a.clientes.anonimizadaId)).not.toContain('Excluir cliente');
    expect(await detalhe(a.clientes.anonimizadaId)).not.toContain('/excluir');
  });

  it('cliente anonimizada volta ao detalhe; profissional vê "Acesso negado"; sem sessão vai a /entrar', async () => {
    await comoGestor(a);
    expect(await destinoDe(PaginaExcluir({ params: Promise.resolve({ id: a.clientes.anonimizadaId }) }))).toBe(ROTAS.cliente(a.clientes.anonimizadaId));
    await comoProfissional(a);
    const html = await excluir(a.clientes.ativaId);
    expect(html).toContain('Acesso negado');
    expect(html).not.toContain(a.clientes.nomeAtiva);
    estadoNext.cookie = undefined;
    expect(await destinoDe(PaginaExcluir({ params: Promise.resolve({ id: a.clientes.ativaId }) }))).toBe(
      `/entrar?proximo=${encodeURIComponent(ROTAS.excluirCliente(a.clientes.ativaId))}`,
    );
  });

  it('cliente de outro salão, inexistente e id inválido → 404', async () => {
    await comoGestor(b);
    for (const id of [a.clientes.ativaId, UUID_INEXISTENTE, 'nao-e-uuid']) {
      await expect(excluir(id)).rejects.toThrow('NEXT_NOT_FOUND');
    }
  });
});

describe('ação-casca excluirClienteAcao (PRG)', () => {
  it('gestor: anonimiza, revalida e redireciona ao detalhe com ?exclusao=ok; repetir → ja_anonimizada', async () => {
    const id = await novaCliente(a, 'Para Excluir');
    await comoGestor(a);
    expect(await destinoDe(excluirClienteAcao(fd(id)))).toBe(`${ROTAS.cliente(id)}?exclusao=ok`);
    expect(await linhaCliente(c, id)).toMatchObject({ nome: null, telefone_e164: null });
    expect(estadoNext.revalidados).toEqual([ROTAS.clientes, ROTAS.cliente(id)]);
    expect(await destinoDe(excluirClienteAcao(fd(id)))).toBe(`${ROTAS.cliente(id)}?exclusao=ja_anonimizada`);
    const html = await detalhe(id, 'ok');
    expect(html).toContain(MENSAGENS_EXCLUSAO.ok);
    expect(html).toContain('Cliente removida');
    expect(await detalhe(id, 'ja_anonimizada')).toContain(MENSAGENS_EXCLUSAO.jaAnonimizada);
    expect(await detalhe(id, 'qualquer')).not.toContain(MENSAGENS_EXCLUSAO.ok);
  });

  it('profissional: ?exclusao=negado e nada muda; sem sessão: /entrar; outro salão ou sem id: lista', async () => {
    const id = await novaCliente(a, 'Intocada');
    const antes = await linhaCliente(c, id);
    await comoProfissional(a);
    expect(await destinoDe(excluirClienteAcao(fd(id)))).toBe(`${ROTAS.cliente(id)}?exclusao=negado`);
    estadoNext.cookie = undefined;
    expect(await destinoDe(excluirClienteAcao(fd(id)))).toBe(`/entrar?proximo=${encodeURIComponent(ROTAS.excluirCliente(id))}`);
    await comoGestor(b);
    expect(await destinoDe(excluirClienteAcao(fd(id)))).toBe(ROTAS.clientes);
    expect(await destinoDe(excluirClienteAcao(fd()))).toBe(ROTAS.clientes);
    expect(await destinoDe(excluirClienteAcao(fd('nao-e-uuid')))).toBe(ROTAS.clientes);
    expect(await linhaCliente(c, id)).toEqual(antes);
    await comoProfissional(a);
    expect(await detalhe(id, 'negado').catch(() => 'acesso')).toContain('Acesso negado');
  });
});
