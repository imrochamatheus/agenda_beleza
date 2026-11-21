import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cancelarAcao, marcarAcao, remarcarAcao } from '@/app/painel/agenda/reservas/[id]/acoes';
import { estadoCancelarInicial, estadoMarcarInicial, estadoRemarcarInicial } from '@/app/painel/agenda/reservas/[id]/estado';
import PaginaReserva from '@/app/painel/agenda/reservas/[id]/page';
import { ROTAS } from '@/config/navegacao';

import { criarSessao } from '../../../support/auth';
import { inserirReservaDireta } from '../../../support/reservas';
import type { CenarioReserva } from '../../../support/reservas';

import { criarCenario, criarConfirmada, db, mensagensDe, reservaDe } from './apoio';

// D-030 CA-13, CA-6, CA-14: a página do detalhe e a casca das ações com sessões reais no PostgreSQL.
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
  vi.spyOn(console, 'error').mockImplementation(() => {});
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
const pagina = async (id: string, busca: Record<string, string> = {}) =>
  renderToStaticMarkup(await PaginaReserva({ params: Promise.resolve({ id }), searchParams: Promise.resolve(busca) }));
const destinoDe = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof Redirecionado) return e.destino;
    throw e;
  }
  throw new Error('esperava um redirect');
};
const form = (campos: Record<string, string | string[]>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) for (const x of Array.isArray(v) ? v : [v]) fd.append(k, x);
  return fd;
};

describe('página do detalhe com ações', () => {
  it('gestor: remarcar (com seletor de profissional) e cancelar; sem marcar situação (ainda não começou)', async () => {
    const c = await criarCenario();
    const id = await criarConfirmada(c, { data: DATA });
    await comoGestor(c);
    const html = await pagina(id);
    expect(html).toContain('Remarcar reserva');
    expect(html).toContain('Cancelar reserva');
    expect(html).not.toContain('Marcar como concluída');
    expect(html).toContain(`value="${DATA}"`);
    expect(html).toContain('value="10:00"');
    expect(html).toMatch(/<option[^>]*value="[0-9a-f-]+"[^>]*>Bia<\/option>/);
  });

  it('profissional da própria reserva: sem seletor de profissional', async () => {
    const c = await criarCenario();
    const id = await criarConfirmada(c, { data: DATA });
    await comoProfissional(c);
    const html = await pagina(id);
    expect(html).toContain('Remarcar reserva');
    expect(html).not.toContain('<select');
    expect(html).toContain(`name="profissionalId" value="${c.ana}"`);
  });

  it('resultado do PRG aparece; valor fora da lista fechada é ignorado', async () => {
    const c = await criarCenario();
    const id = await criarConfirmada(c, { data: DATA });
    await comoGestor(c);
    expect(await pagina(id, { resultado: 'cancelada' })).toContain('Reserva cancelada.');
    expect(await pagina(id, { resultado: '<b>x</b>' })).not.toContain('<b>x</b>');
  });

  it('reserva cancelada: nenhuma ação', async () => {
    const c = await criarCenario();
    const id = await criarConfirmada(c, { data: DATA });
    await db().reserva.update({ where: { id }, data: { status: 'cancelado' } });
    await comoGestor(c);
    const html = await pagina(id);
    expect(html).not.toContain('Remarcar reserva');
    expect(html).not.toContain('Cancelar reserva');
  });
});

describe('casca das ações', () => {
  it('cancelar: o passo "confirmar" só pede a confirmação; "cancelar" grava e faz PRG', async () => {
    const c = await criarCenario();
    const id = await criarConfirmada(c, { data: DATA });
    await comoGestor(c);
    expect(await cancelarAcao(estadoCancelarInicial, form({ reservaId: id, passo: 'confirmar' }))).toEqual({ mensagem: null, confirmando: true });
    expect(await cancelarAcao(estadoCancelarInicial, form({ reservaId: id, passo: 'voltar' }))).toEqual({ mensagem: null, confirmando: false });
    expect((await reservaDe(id)).status).toBe('confirmado');
    expect(await destinoDe(cancelarAcao(estadoCancelarInicial, form({ reservaId: id, passo: 'cancelar' })))).toBe(`${ROTAS.agendaReserva(id)}?resultado=cancelada`);
    expect((await reservaDe(id)).status).toBe('cancelado');
    // clique duplo: recusado pela máquina
    expect((await cancelarAcao(estadoCancelarInicial, form({ reservaId: id, passo: 'cancelar' }))).mensagem).toContain('cancelada');
  });

  it('remarcar: sucesso faz PRG; encaixe volta na resposta; sem sessão vai para /entrar', async () => {
    const c = await criarCenario();
    const id = await criarConfirmada(c, { data: DATA });
    const estado = estadoRemarcarInicial({ data: DATA, hora: '10:00', profissionalId: c.ana, servicoIds: [c.A], confirmarEncaixe: false });
    const base = { reservaId: id, data: DATA, profissionalId: c.ana, s: c.A };
    expect(await destinoDe(remarcarAcao(estado, form({ ...base, hora: '14:00' })))).toContain(ROTAS.entrar);
    await comoGestor(c);
    const aviso = await remarcarAcao(estado, form({ ...base, hora: '20:00' }));
    expect(aviso.motivos).toEqual(['fora_da_jornada']);
    expect(aviso.valores.hora).toBe('20:00');
    expect(await destinoDe(remarcarAcao(estado, form({ ...base, hora: '14:00' })))).toBe(`${ROTAS.agendaReserva(id)}?resultado=remarcada`);
    expect((await reservaDe(id)).revisao).toBe(1);
    expect((await mensagensDe(id)).some((m) => m.tipo === 'remarcacao' && m.revisao === 1)).toBe(true);
  });

  it('marcar: antes do início a resposta recusa; id de outro salão e profissional alheio têm mensagens uniformes', async () => {
    const c = await criarCenario();
    const outro = await criarCenario();
    const id = await criarConfirmada(c, { data: DATA });
    const daBia = await criarConfirmada(c, { data: DATA, profissionalId: c.bia, hora: '12:00' });
    const alheia = await criarConfirmada(outro, { data: DATA });
    await comoGestor(c);
    expect((await marcarAcao(estadoMarcarInicial, form({ reservaId: id, para: 'concluido' }))).mensagem).toBe('A reserva ainda não começou.');
    expect((await marcarAcao(estadoMarcarInicial, form({ reservaId: alheia, para: 'concluido' }))).mensagem).toBe('Reserva não encontrada.');
    expect((await reservaDe(alheia)).status).toBe('confirmado');
    await comoProfissional(c);
    expect((await marcarAcao(estadoMarcarInicial, form({ reservaId: daBia, para: 'concluido' }))).mensagem).toBe('Acesso negado.');
    expect((await cancelarAcao(estadoCancelarInicial, form({ reservaId: daBia, passo: 'cancelar' }))).mensagem).toBe('Acesso negado.');
    const estado = estadoRemarcarInicial({ data: DATA, hora: '10:00', profissionalId: c.bia, servicoIds: [c.A], confirmarEncaixe: false });
    expect((await remarcarAcao(estado, form({ reservaId: daBia, data: DATA, hora: '15:00', profissionalId: c.bia, s: c.A }))).mensagem).toBe('Acesso negado.');
    expect((await reservaDe(daBia)).revisao).toBe(0);
  });

  it('marcar com sessão e reserva iniciada: PRG de sucesso', async () => {
    const c = await criarCenario();
    // Reserva no passado só existe por inserção direta (a criação recusa o passado).
    const direta = await criarNoPassado(c);
    await comoGestor(c);
    expect(await destinoDe(marcarAcao(estadoMarcarInicial, form({ reservaId: direta, para: 'nao_compareceu' })))).toBe(`${ROTAS.agendaReserva(direta)}?resultado=nao_compareceu`);
    expect((await reservaDe(direta)).status).toBe('nao_compareceu');
  });
});

async function criarNoPassado(c: CenarioReserva): Promise<string> {
  return inserirReservaDireta(c, { inicio: new Date('2020-03-03T13:00:00Z'), fim: new Date('2020-03-03T13:30:00Z') });
}
