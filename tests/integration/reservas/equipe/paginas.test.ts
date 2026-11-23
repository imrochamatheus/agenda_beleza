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

// D-029 CA-4, CA-15, CA-16, CA-17 e D-050 CA-23/CA-36 (casca): a página e a casca da ação com sessões reais no PostgreSQL.
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
    data: DATA,
    itens: '1',
    'item-1-servico': c.A,
    'item-1-profissional': c.ana,
    'item-1-hora': '10:00',
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
    // D-050 §5.8: botão padrão oculto como primeiro filho do formulário (C5), uma linha e "Adicionar outro serviço".
    expect(html).toMatch(/<form[^>]*><button type="submit" hidden="" tabindex="-1"><\/button>/);
    expect(html).toContain('name="item-1-servico"');
    expect(html).toContain('Adicionar outro serviço');
    expect(html).not.toContain('mesmo profissional');
    expect(html).not.toContain(outro.ana);
    expect(html).not.toContain(outro.A);
    // profissional de outro salão na query vale como ausente (sem 404 revelador)
    expect(await pagina({ profissional: outro.ana })).not.toMatch(/<option value="[0-9a-f-]{36}" selected/);
  });

  it('profissional: sem seletor, só o próprio; a query não troca de profissional', async () => {
    const c = await criarCenarioReserva();
    await comoProfissional(c);
    const html = await pagina({ profissional: c.bia });
    // Só o seletor de serviço; nenhum de profissional.
    expect(html).not.toMatch(/<select[^>]*name="item-1-profissional"/);
    expect(html).toMatch(/<select[^>]*name="item-1-servico"/);
    expect(html).toContain(`type="hidden" name="item-1-profissional" value="${c.ana}"`);
    expect(html).toContain('(você)');
    expect(html).not.toContain(c.bia);
  });
});

describe('casca da ação (sem PRG, como o POST sem JavaScript)', () => {
  it('encaixe: o primeiro envio devolve o aviso com os dados e a mesma chave; reenviar confirmado cria', async () => {
    const c = await criarCenarioReserva({ jornada: [['09:00', '18:00']] });
    await comoGestor(c);
    const fd = formulario(c, { 'item-1-hora': '19:00', nome: 'Joana' });
    const anterior = estadoInicial('x', valoresVazios());
    const a = await criarReservaManualAcao(anterior, fd);
    expect(a.encaixe).toEqual([{ indice: 0, motivos: ['fora_da_jornada'] }]);
    expect(a.valores).toMatchObject({ nome: 'Joana', data: DATA, itens: [{ servicoId: c.A, profissionalId: c.ana, hora: '19:00' }] });
    expect(a.chave).toBe(fd.get('chave'));
    expect(await obterPrisma().reserva.count({ where: { salaoId: c.s.salaoId } })).toBe(0);

    fd.set('confirmarEncaixe', 'on');
    const b = await criarReservaManualAcao(a, fd);
    expect(b.criada).toMatchObject({ encaixes: 1, repetida: false });
    expect(b.chave).not.toBe(a.chave);
    expect(b.criada?.hrefAgenda).toContain(`data=${DATA}`);
    const linhas = await obterPrisma().reserva.findMany({ where: { salaoId: c.s.salaoId }, include: { itens: true } });
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({ origem: 'equipe' });
    expect(linhas[0].itens.map((i) => i.encaixe)).toEqual([true]);
  });

  it('duplo envio com a mesma chave: segunda resposta repetida, uma só reserva', async () => {
    const c = await criarCenarioReserva();
    await comoGestor(c);
    const fd = formulario(c, {});
    const a = await criarReservaManualAcao(estadoInicial('x', valoresVazios()), fd);
    const b = await criarReservaManualAcao(estadoInicial('x', valoresVazios()), fd);
    expect(a.criada).toMatchObject({ encaixes: 0, repetida: false });
    expect(b.criada).toMatchObject({ repetida: true });
    expect(await obterPrisma().reserva.count({ where: { salaoId: c.s.salaoId } })).toBe(1);
  });

  it('erros de campo voltam no estado; sem sessão redireciona; 403 e 404 viram mensagem', async () => {
    const c = await criarCenarioReserva();
    const outro = await criarCenarioReserva();
    const anterior = estadoInicial('x', valoresVazios());
    await expect(criarReservaManualAcao(anterior, formulario(c, {}))).rejects.toBeInstanceOf(Redirecionado);

    await comoGestor(c);
    const inv = await criarReservaManualAcao(anterior, formulario(c, { nome: '', telefone: '1', 'item-1-hora': 'xx', 'item-1-servico': '' }));
    expect(Object.keys(inv.erros).sort()).toEqual(['nome', 'telefone']);
    expect(inv.errosPorLinha).toEqual({ 0: { servico: 'Escolha o serviço.', hora: 'Informe a hora no formato HH:MM.' } });
    const foraDoSalao = await criarReservaManualAcao(anterior, formulario(c, { 'item-1-profissional': outro.ana }));
    expect(foraDoSalao.mensagem).toBe('Profissional não encontrado.');

    await comoProfissional(c);
    const negado = await criarReservaManualAcao(anterior, formulario(c, { 'item-1-profissional': c.bia }));
    expect(negado.mensagem).toBe('Acesso negado.');
    expect(await obterPrisma().reserva.count({ where: { salaoId: c.s.salaoId } })).toBe(0);
  });
});

describe('D-050: linhas e vários serviços pela casca (POST sem JavaScript)', () => {
  it('"Adicionar outro serviço" e "Remover": estado com uma linha a mais/a menos, valores preservados, sem sessão e sem gravar', async () => {
    const c = await criarCenarioReserva();
    const anterior = estadoInicial('x', valoresVazios());
    const fd = formulario(c, { linha: 'adicionar', nome: 'Joana', 'item-1-hora': '09:15' });
    const a = await criarReservaManualAcao(anterior, fd);
    expect(a.valores.itens).toEqual([{ servicoId: c.A, profissionalId: c.ana, hora: '09:15' }, { servicoId: '', profissionalId: '', hora: '' }]);
    expect(a.valores).toMatchObject({ nome: 'Joana', data: DATA });
    expect(a.statusLinha).toBe('Linha de serviço adicionada.');
    expect(a.chave).toBe(fd.get('chave'));

    const fd2 = formulario(c, { itens: '2', 'item-2-servico': c.B, 'item-2-profissional': c.ana, 'item-2-hora': '11:00', linha: 'remover:1' });
    const b = await criarReservaManualAcao(a, fd2);
    expect(b.valores.itens).toEqual([{ servicoId: c.B, profissionalId: c.ana, hora: '11:00' }]);
    expect(b.statusLinha).toBe('Serviço 1 removido.');
    expect(await obterPrisma().reserva.count({ where: { salaoId: c.s.salaoId } })).toBe(0);
  });

  it('dois serviços de uma vez; sobreposição entre eles volta como erro da linha', async () => {
    const c = await criarCenarioReserva();
    await comoGestor(c);
    const anterior = estadoInicial('x', valoresVazios());
    const cruzado = await criarReservaManualAcao(
      anterior,
      formulario(c, { itens: '2', 'item-2-servico': c.B, 'item-2-profissional': c.ana, 'item-2-hora': '10:15' }),
    );
    expect(cruzado.errosPorLinha).toEqual({ 1: { hora: 'Este horário se sobrepõe ao Serviço 1 (A, 10:00–10:30).' } });
    expect(await obterPrisma().reserva.count({ where: { salaoId: c.s.salaoId } })).toBe(0);

    const ok = await criarReservaManualAcao(
      anterior,
      formulario(c, { itens: '2', 'item-2-servico': c.B, 'item-2-profissional': c.ana, 'item-2-hora': '10:30' }),
    );
    expect(ok.criada?.itens.map((i) => i.servicoId)).toEqual([c.A, c.B]);
    expect(ok.criada?.hrefAgenda).toContain(`profissional=${c.ana}`);
    expect(await obterPrisma().reservaItem.count({ where: { salaoId: c.s.salaoId } })).toBe(2);
  });
});
