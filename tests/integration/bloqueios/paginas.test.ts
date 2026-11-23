import type pg from 'pg';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import PaginaEditarBloqueio from '@/app/painel/bloqueios/[id]/page';
import { criarBloqueioAcao, editarBloqueioAcao, removerBloqueioAcao } from '@/app/painel/bloqueios/acoes';
import { estadoInicial, VALORES_VAZIOS } from '@/app/painel/bloqueios/estado';
import PaginaBloqueios from '@/app/painel/bloqueios/page';
import { ROTAS } from '@/config/navegacao';
import { MENSAGENS_BLOQUEIO } from '@/server/bloqueios/tipos';

import { criarSessao, criarSuperAdmin } from '../../support/auth';
import { criarDoisSaloes, criarSalaoCompleto } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { conectar } from '../../support/sql';

import { MANAUS, UUID_INEXISTENTE, apagarBloqueios, criarReservaEm, definirFuso, inserirBloqueio, itemDe, linhaBloqueio, linhasBloqueio } from './apoio';

// D-016 T-8: páginas e casca de /painel/bloqueios com sessões reais no PostgreSQL. next/headers
// (cookies), next/navigation (redirect, notFound) e next/cache (revalidatePath) são substituídos (não é
// mock de banco). As páginas são renderizadas com renderToStaticMarkup. As páginas usam o relógio real:
// as datas daqui ficam no próximo ano (ANO), sempre futuras.

const M = MENSAGENS_BLOQUEIO;
const ANO = new Date().getUTCFullYear() + 1;

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

const lista = async (remocao?: string) =>
  renderToStaticMarkup(await PaginaBloqueios({ searchParams: Promise.resolve(remocao ? { remocao } : {}) }));
const edicao = async (id: string) => renderToStaticMarkup(await PaginaEditarBloqueio({ params: Promise.resolve({ id }) }));

function formulario(campos: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
}
const comHorario = (di: string, hi: string, df: string, hf: string, extra: Record<string, string> = {}) =>
  formulario({ modo: 'horario', dataInicio: di, horaInicio: hi, dataFim: df, horaFim: hf, motivo: '', ...extra });
const diaInteiro = (di: string, df = di, extra: Record<string, string> = {}) =>
  formulario({ modo: 'dia_inteiro', dataInicio: di, horaInicio: '', dataFim: df, horaFim: '', motivo: '', ...extra });

/** Instante ISO no próximo ano. */
const em = (mmdd: string, hhmm: string) => `${ANO}-${mmdd}T${hhmm}:00Z`;

describe('página /painel/bloqueios: gestor', () => {
  it('CA-3/CA-22: a casca cria o bloqueio do salão de dia inteiro; estado salvo com aviso; revalida; a lista exibe "(dia inteiro)"', async () => {
    const s = await criarSalaoCompleto();
    await apagarBloqueios(c, s.salaoId);
    await comoGestor(s);
    const r = await criarBloqueioAcao(estadoInicial(), diaInteiro(`25/12/${ANO}`, `25/12/${ANO}`, { alvo: 'salao', motivo: 'Natal' }));
    expect(r).toEqual({
      mensagem: null,
      erros: {},
      valores: VALORES_VAZIOS,
      salvo: { periodo: `25/12/${ANO} (dia inteiro)`, aviso: { total: 0, reservas: [] } },
    });
    expect(estadoNext.revalidados).toEqual([ROTAS.bloqueios]);
    expect(await linhasBloqueio(c, s.salaoId)).toEqual([
      expect.objectContaining({ profissional_id: null, inicio: em('12-25', '03:00'), fim: em('12-26', '03:00'), motivo: 'Natal' }),
    ]);
    const html = await lista();
    expect(html).toContain('<h1>Bloqueios</h1>');
    expect(html).toContain('Novo bloqueio');
    expect(html).toContain(`25/12/${ANO} (dia inteiro)`);
    expect(html).toContain('Motivo: Natal');
    expect(html).toContain('Salão inteiro');
    // Select de alvo com profissionais (inativo marcado, CA-15).
    expect(html).toContain('name="alvo"');
    expect(html).toContain(`>Ex-profissional`);
    expect(html).toMatch(/Ex-profissional [^<]*\(inativo\)/);
    expect(html).toContain('aria-current="page"');
  });

  it('CA-5/CA-4: com horário atravessando a meia-noite; aviso com a reserva coberta; data e hora nas duas pontas', async () => {
    const s = await criarSalaoCompleto();
    await comoGestor(s);
    const reserva = await criarReservaEm(c, {
      salaoId: s.salaoId,
      profissionalId: s.profissional.profissionalId,
      clienteId: s.clientes.ativaId,
      inicio: em('12-26', '02:00'),
      fim: em('12-26', '03:00'),
    });
    const r = await criarBloqueioAcao(
      estadoInicial(),
      comHorario(`25/12/${ANO}`, '22:00', `26/12/${ANO}`, '02:00', { alvo: s.profissional.profissionalId }),
    );
    expect(r.salvo?.periodo).toBe(`25/12/${ANO} 22:00 a 26/12/${ANO} 02:00`);
    expect(r.salvo?.aviso.reservas).toEqual([
      { id: reserva, itemId: await itemDe(c, reserva), profissionalNome: s.profissional.nome, inicioLocal: `25/12/${ANO} 23:00`, fimLocal: `26/12/${ANO} 00:00`, cliente: s.clientes.nomeAtiva },
    ]);
    expect(await lista()).toContain(`25/12/${ANO} 22:00 a 26/12/${ANO} 02:00`);
  });

  it('CA-17/CA-18: troca de fuso só muda a exibição; encerrados não aparecem', async () => {
    const s = await criarSalaoCompleto();
    await apagarBloqueios(c, s.salaoId);
    await comoGestor(s);
    const futuro = await inserirBloqueio(c, { salaoId: s.salaoId, profissionalId: s.profissional.profissionalId, inicio: em('03-10', '17:00'), fim: em('03-10', '19:00') });
    await inserirBloqueio(c, { salaoId: s.salaoId, profissionalId: null, inicio: '2020-01-01T03:00Z', fim: '2020-01-02T03:00Z', motivo: 'Antigo' });
    expect(await lista()).toContain(`10/03/${ANO} 14:00 a 10/03/${ANO} 16:00`);
    const antes = await linhaBloqueio(c, futuro);
    await definirFuso(c, s.salaoId, MANAUS);
    const html = await lista();
    expect(html).toContain(`10/03/${ANO} 13:00 a 10/03/${ANO} 15:00`);
    expect(html).not.toContain('Antigo');
    expect(await linhaBloqueio(c, futuro)).toEqual(antes);
  });

  it('lista vazia → texto de nenhum bloqueio; ?remocao=ok|nao_encontrado|negado → alertas', async () => {
    const s = await criarSalaoCompleto();
    await apagarBloqueios(c, s.salaoId);
    await comoGestor(s);
    expect(await lista()).toContain(M.vazio);
    expect(await lista('ok')).toContain(M.removido);
    expect(await lista('nao_encontrado')).toContain(M.naoEncontrado);
    expect(await lista('negado')).toContain(M.acessoNegado);
    const sem = await lista('outro');
    expect(sem).not.toContain(M.removido);
    expect(sem).not.toContain(M.naoEncontrado);
  });

  it('CA-13: a lista de A nunca mostra bloqueios de B', async () => {
    await inserirBloqueio(c, { salaoId: b.salaoId, profissionalId: null, inicio: em('04-01', '03:00'), fim: em('04-02', '03:00'), motivo: 'Segredo de B' });
    await comoGestor(a);
    const html = await lista();
    expect(html).not.toContain('Segredo de B');
    expect(html).not.toContain(b.profissional.nome);
  });
});

describe('página /painel/bloqueios: profissional (CA-14)', () => {
  it('vê os próprios (editar/remover) e os do salão (somente leitura), nunca os do colega; sem select', async () => {
    const s = await criarSalaoCompleto();
    await apagarBloqueios(c, s.salaoId);
    const proprio = await inserirBloqueio(c, { salaoId: s.salaoId, profissionalId: s.profissional.profissionalId, inicio: em('05-10', '17:00'), fim: em('05-10', '19:00'), motivo: 'Meu' });
    await inserirBloqueio(c, { salaoId: s.salaoId, profissionalId: null, inicio: em('05-11', '03:00'), fim: em('05-12', '03:00'), motivo: 'DoSalao' });
    await inserirBloqueio(c, { salaoId: s.salaoId, profissionalId: s.gestor.profissionalId, inicio: em('05-12', '17:00'), fim: em('05-12', '19:00'), motivo: 'DoColega' });
    await comoProfissional(s);
    const html = await lista();
    expect(html).toContain('Motivo: Meu');
    expect(html).toContain('Motivo: DoSalao');
    expect(html).not.toContain('DoColega');
    expect(html).toContain(M.somenteLeitura);
    expect(html).toContain(`href="${ROTAS.bloqueio(proprio)}"`);
    expect(html.match(/Remover bloqueio:/g)).toHaveLength(1);
    expect(html).not.toContain('name="alvo"');
    expect(html).toContain(M.propriaAgenda);
  });

  it('CA-1/CA-22: a casca cria na própria agenda (sem alvo) e remove o próprio (PRG ?remocao=ok)', async () => {
    const s = await criarSalaoCompleto();
    await comoProfissional(s);
    const r = await criarBloqueioAcao(estadoInicial(), comHorario(`10/06/${ANO}`, '14:00', `10/06/${ANO}`, '16:00', { motivo: 'Dentista' }));
    expect(r.salvo?.periodo).toBe(`10/06/${ANO} 14:00 a 10/06/${ANO} 16:00`);
    const linhas = await linhasBloqueio(c, s.salaoId);
    const criado = linhas.find((l) => l.motivo === 'Dentista')!;
    expect(criado.profissional_id).toBe(s.profissional.profissionalId);
    expect(await destinoDe(removerBloqueioAcao(formulario({ id: criado.id })))).toBe(`${ROTAS.bloqueios}?remocao=ok`);
    expect(estadoNext.revalidados).toContain(ROTAS.bloqueios);
    expect(await linhaBloqueio(c, criado.id)).toBeUndefined();
  });

  it('a casca: alvo do salão → mensagem de acesso negado, valores preservados; remover do salão → ?remocao=negado', async () => {
    const s = await criarSalaoCompleto();
    const doSalao = await inserirBloqueio(c, { salaoId: s.salaoId, profissionalId: null, inicio: em('06-11', '03:00'), fim: em('06-12', '03:00') });
    await comoProfissional(s);
    const r = await criarBloqueioAcao(estadoInicial(), diaInteiro(`11/06/${ANO}`, `11/06/${ANO}`, { alvo: 'salao' }));
    expect(r).toMatchObject({ mensagem: M.acessoNegado, erros: {}, salvo: null, valores: { alvo: 'salao', dataInicio: `11/06/${ANO}` } });
    expect(await destinoDe(removerBloqueioAcao(formulario({ id: doSalao })))).toBe(`${ROTAS.bloqueios}?remocao=negado`);
    expect(await linhaBloqueio(c, doSalao)).toBeDefined();
  });
});

describe('casca: validação, extras, sessão e remoção', () => {
  it('inválido → erros e valores preservados; nomes desconhecidos ignorados (salaoId de B não chega)', async () => {
    const s = await criarSalaoCompleto();
    await comoGestor(s);
    const antesB = await linhasBloqueio(c, b.salaoId);
    const r = await criarBloqueioAcao(estadoInicial(), comHorario(`10/07/${ANO}`, '14:07', `10/07/${ANO}`, '25:00', { alvo: 'salao', salaoId: b.salaoId }));
    expect(r).toEqual({
      mensagem: null,
      erros: { horaInicio: M.granularidade, horaFim: M.hora },
      valores: { alvo: 'salao', modo: 'horario', dataInicio: `10/07/${ANO}`, horaInicio: '14:07', dataFim: `10/07/${ANO}`, horaFim: '25:00', motivo: '' },
      salvo: null,
    });
    expect(estadoNext.revalidados).toEqual([]);
    // Válido com o salaoId extra → grava em s, nunca em B.
    const ok = await criarBloqueioAcao(estadoInicial(), diaInteiro(`10/07/${ANO}`, `10/07/${ANO}`, { alvo: 'salao', salaoId: b.salaoId }));
    expect(ok.salvo).not.toBeNull();
    expect(await linhasBloqueio(c, b.salaoId)).toEqual(antesB);
  });

  it('gestor com alvo de B → mensagem "não encontrado"', async () => {
    await comoGestor(a);
    const r = await criarBloqueioAcao(estadoInicial(), diaInteiro(`12/07/${ANO}`, `12/07/${ANO}`, { alvo: b.profissional.profissionalId }));
    expect(r.mensagem).toBe(M.naoEncontrado);
  });

  it('sem sessão: criar, editar e remover → /entrar?proximo=', async () => {
    expect(await destinoDe(criarBloqueioAcao(estadoInicial(), diaInteiro(`12/07/${ANO}`)))).toBe('/entrar?proximo=%2Fpainel%2Fbloqueios');
    expect(await destinoDe(editarBloqueioAcao(estadoInicial(), diaInteiro(`12/07/${ANO}`, `12/07/${ANO}`, { id: 'abc' })))).toBe(
      '/entrar?proximo=%2Fpainel%2Fbloqueios%2Fabc',
    );
    expect(await destinoDe(editarBloqueioAcao(estadoInicial(), diaInteiro(`12/07/${ANO}`)))).toBe('/entrar?proximo=%2Fpainel%2Fbloqueios');
    expect(await destinoDe(removerBloqueioAcao(formulario({ id: 'abc' })))).toBe('/entrar?proximo=%2Fpainel%2Fbloqueios');
    expect(await destinoDe(lista())).toBe('/entrar?proximo=%2Fpainel%2Fbloqueios');
    expect(await destinoDe(edicao('abc'))).toBe('/entrar?proximo=%2Fpainel%2Fbloqueios%2Fabc');
  });

  it('editar: salvo revalida a lista e a edição; mantém os valores enviados; de B → mensagem "não encontrado"', async () => {
    const s = await criarSalaoCompleto();
    await comoGestor(s);
    const id = await inserirBloqueio(c, { salaoId: s.salaoId, profissionalId: null, inicio: em('08-01', '03:00'), fim: em('08-02', '03:00') });
    const fd = diaInteiro(`02/08/${ANO}`, `03/08/${ANO}`, { id, motivo: 'Reforma' });
    const r = await editarBloqueioAcao(estadoInicial(), fd);
    expect(r).toMatchObject({ mensagem: null, erros: {}, salvo: { periodo: `02/08/${ANO} a 03/08/${ANO}` }, valores: { dataInicio: `02/08/${ANO}`, motivo: 'Reforma' } });
    expect(estadoNext.revalidados).toEqual([ROTAS.bloqueios, ROTAS.bloqueio(id)]);
    expect(await linhaBloqueio(c, id)).toMatchObject({ inicio: em('08-02', '03:00'), fim: em('08-04', '03:00'), motivo: 'Reforma' });
    expect((await editarBloqueioAcao(estadoInicial(), diaInteiro(`02/08/${ANO}`, `02/08/${ANO}`, { id: b.bloqueioId }))).mensagem).toBe(M.naoEncontrado);
    expect((await editarBloqueioAcao(estadoInicial(), diaInteiro(`02/08/${ANO}`, `40/08/${ANO}`, { id }))).erros).toEqual({ dataFim: M.dataInexistente });
  });

  it('remover: inexistente, de B ou sem id → ?remocao=nao_encontrado', async () => {
    await comoGestor(a);
    for (const fd of [formulario({ id: UUID_INEXISTENTE }), formulario({ id: b.bloqueioId }), formulario({})]) {
      expect(await destinoDe(removerBloqueioAcao(fd))).toBe(`${ROTAS.bloqueios}?remocao=nao_encontrado`);
    }
    expect(estadoNext.revalidados).toEqual([]);
  });
});

describe('página de edição /painel/bloqueios/[id]', () => {
  it('gestor: valores do bloqueio (dia inteiro), alvo como texto, link de volta e período atual', async () => {
    const s = await criarSalaoCompleto();
    const id = await inserirBloqueio(c, { salaoId: s.salaoId, profissionalId: null, inicio: em('09-01', '03:00'), fim: em('09-03', '03:00'), motivo: 'Reforma' });
    await comoGestor(s);
    const html = await edicao(id);
    expect(html).toContain('<h1>Editar bloqueio</h1>');
    expect(html).toContain(`href="${ROTAS.bloqueios}"`);
    expect(html).toContain(`01/09/${ANO} a 02/09/${ANO}`);
    expect(html).toContain(`name="id" value="${id}"`);
    expect(html).toContain('Salão inteiro');
    expect(html).toContain(`value="01/09/${ANO}"`);
    expect(html).toContain(`value="02/09/${ANO}"`);
    expect(html).toContain('value="Reforma"');
    expect(html).toContain('name="modo" checked="" value="dia_inteiro"');
    expect(html).toContain('Salvar alterações');
  });

  it('profissional: o próprio abre; o do salão → "Acesso negado"; de B, inexistente ou malformado → notFound', async () => {
    const s = await criarSalaoCompleto();
    const doSalao = await inserirBloqueio(c, { salaoId: s.salaoId, profissionalId: null, inicio: em('09-05', '03:00'), fim: em('09-06', '03:00') });
    await comoProfissional(s);
    expect(await edicao(s.bloqueioId)).toContain('Editar bloqueio');
    expect(await edicao(doSalao)).toContain('Acesso negado');
    for (const id of [b.bloqueioId, UUID_INEXISTENTE, 'abc']) {
      expect(await falhaDe(edicao(id))).toBeInstanceOf(NaoEncontradoNext);
    }
  });

  it('super admin → "Acesso negado" na lista e na edição', async () => {
    const admin = await criarSuperAdmin({ totpVerificado: true });
    estadoNext.cookie = admin.credencial!.token;
    expect(await lista()).toContain('Acesso negado');
    expect(await edicao(a.bloqueioId)).toContain('Acesso negado');
  });
});
