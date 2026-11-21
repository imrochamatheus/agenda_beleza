import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { criarReservaManualAcao } from '@/app/painel/agenda/nova/acoes';
import { estadoInicial, valoresVazios } from '@/app/painel/agenda/nova/estado';
import PaginaNovaReserva from '@/app/painel/agenda/nova/page';
import { ROTAS } from '@/config/navegacao';
import { obterPrisma } from '@/server/repos/db';

import { criarSessao } from '../../../support/auth';
import { criarCenarioReserva } from '../../../support/reservas';
import type { CenarioReserva } from '../../../support/reservas';
import { telefoneNovo } from '../../../support/sql';

// D-029 CA-4, CA-15, CA-16, CA-17: a página e a casca da ação com sessões reais no PostgreSQL.
// next/headers (cookies) e next/navigation (redirect) são substituídos; o banco é real.

class Redirecionado extends Error {
  constructor(readonly destino: string) {
    super(`NEXT_REDIRECT ${destino}`);
  }
}

const estadoNext = vi.hoisted(() => ({ cookie: undefined as string | undefined }));

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

const DATA = '2035-03-06';

beforeEach(() => {
  estadoNext.cookie = undefined;
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

const comoGestor = async (c: CenarioReserva) => {
  estadoNext.cookie = (await criarSessao(c.s.gestor.usuarioId)).token;
};
const comoProfissional = async (c: CenarioReserva) => {
  estadoNext.cookie = (await criarSessao(c.s.profissional.usuarioId)).token;
};
const pagina = async (params: Record<string, string | string[]> = {}) =>
  renderToStaticMarkup(await PaginaNovaReserva({ searchParams: Promise.resolve(params) }));

function formulario(c: CenarioReserva, campos: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  const base: Record<string, string | string[]> = {
    s: c.A,
    profissionalId: c.ana,
    data: DATA,
    hora: '10:00',
    nome: 'Cliente de Balcão',
    telefone: telefoneNovo(),
    chave: crypto.randomUUID(),
    ...campos,
  };
  for (const [k, v] of Object.entries(base)) for (const x of Array.isArray(v) ? v : [v]) fd.append(k, x);
  return fd;
}

describe('página /painel/agenda/nova', () => {
  it('sem sessão: redireciona para /entrar?proximo=', async () => {
    const e = await pagina().catch((x: unknown) => x);
    expect(e).toBeInstanceOf(Redirecionado);
    expect((e as Redirecionado).destino).toBe(`/entrar?proximo=${encodeURIComponent(ROTAS.novaReserva)}`);
  });

  it('gestor: só serviços e profissionais do próprio salão; pré-preenche a query; chave UUID', async () => {
    const c = await criarCenarioReserva();
    const outro = await criarCenarioReserva();
    await comoGestor(c);
    const html = await pagina({ profissional: c.bia, data: DATA, hora: '14:30' });
    expect(html).toContain('<h1>Nova reserva</h1>');
    expect(html).toContain('Ana');
    expect(html).toContain('Bia');
    expect(html).toMatch(/R\$\s50,00/);
    expect(html).toContain(`value="${DATA}"`);
    expect(html).toContain('value="14:30"');
    expect(html).toMatch(new RegExp(`<option value="${c.bia}" selected`));
    expect(html).toMatch(/name="chave" value="[0-9a-f-]{36}"/);
    expect(html).not.toContain(outro.ana);
    expect(html).not.toContain(outro.A);
    // profissional de outro salão na query vale como ausente (sem 404 revelador)
    expect(await pagina({ profissional: outro.ana })).not.toMatch(/<option value="[0-9a-f-]{36}" selected/);
  });

  it('profissional: sem seletor, só o próprio; a query não troca de profissional', async () => {
    const c = await criarCenarioReserva();
    await comoProfissional(c);
    const html = await pagina({ profissional: c.bia });
    expect(html).not.toContain('<select');
    expect(html).toContain(`type="hidden" name="profissionalId" value="${c.ana}"`);
    expect(html).not.toContain(c.bia);
  });
});

describe('casca da ação (sem PRG, como o POST sem JavaScript)', () => {
  it('encaixe: o primeiro envio devolve o aviso com os dados e a mesma chave; reenviar confirmado cria', async () => {
    const c = await criarCenarioReserva({ jornada: [['09:00', '18:00']] });
    await comoGestor(c);
    const fd = formulario(c, { hora: '19:00', nome: 'Joana' });
    const anterior = estadoInicial('x', valoresVazios());
    const a = await criarReservaManualAcao(anterior, fd);
    expect(a.motivos).toEqual(['fora_da_jornada']);
    expect(a.valores).toMatchObject({ nome: 'Joana', hora: '19:00', data: DATA, servicoIds: [c.A] });
    expect(a.chave).toBe(fd.get('chave'));
    expect(await obterPrisma().reserva.count({ where: { salaoId: c.s.salaoId } })).toBe(0);

    fd.set('confirmarEncaixe', 'on');
    const b = await criarReservaManualAcao(a, fd);
    expect(b.criada).toMatchObject({ encaixe: true, repetida: false });
    expect(b.chave).not.toBe(a.chave);
    expect(b.criada?.hrefAgenda).toContain(`data=${DATA}`);
    const linhas = await obterPrisma().reserva.findMany({ where: { salaoId: c.s.salaoId } });
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({ encaixe: true, origem: 'equipe' });
  });

  it('duplo envio com a mesma chave: segunda resposta repetida, uma só reserva', async () => {
    const c = await criarCenarioReserva();
    await comoGestor(c);
    const fd = formulario(c, {});
    const a = await criarReservaManualAcao(estadoInicial('x', valoresVazios()), fd);
    const b = await criarReservaManualAcao(estadoInicial('x', valoresVazios()), fd);
    expect(a.criada).toMatchObject({ encaixe: false, repetida: false });
    expect(b.criada).toMatchObject({ repetida: true });
    expect(await obterPrisma().reserva.count({ where: { salaoId: c.s.salaoId } })).toBe(1);
  });

  it('erros de campo voltam no estado; sem sessão redireciona; 403 e 404 viram mensagem', async () => {
    const c = await criarCenarioReserva();
    const outro = await criarCenarioReserva();
    const anterior = estadoInicial('x', valoresVazios());
    await expect(criarReservaManualAcao(anterior, formulario(c, {}))).rejects.toBeInstanceOf(Redirecionado);

    await comoGestor(c);
    const inv = await criarReservaManualAcao(anterior, formulario(c, { nome: '', telefone: '1', hora: 'xx', s: [] }));
    expect(Object.keys(inv.erros).sort()).toEqual(['data', 'nome', 'telefone']);
    const foraDoSalao = await criarReservaManualAcao(anterior, formulario(c, { profissionalId: outro.ana }));
    expect(foraDoSalao.mensagem).toBe('Profissional não encontrado.');

    await comoProfissional(c);
    const negado = await criarReservaManualAcao(anterior, formulario(c, { profissionalId: c.bia }));
    expect(negado.mensagem).toBe('Acesso negado.');
    expect(await obterPrisma().reserva.count({ where: { salaoId: c.s.salaoId } })).toBe(0);
  });
});
