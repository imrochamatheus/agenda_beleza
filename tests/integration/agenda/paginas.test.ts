import type pg from 'pg';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import PaginaAgenda from '@/app/painel/agenda/page';
import PaginaReserva from '@/app/painel/agenda/reservas/[id]/page';
import { ROTAS } from '@/config/navegacao';

import { criarSessao } from '../../support/auth';
import { criarMensagem } from '../../support/mensagens';
import { definirAssinatura } from '../../support/reserva-publica';
import type { CenarioReserva } from '../../support/reservas';
import { conectar } from '../../support/sql';

import { UUID_INEXISTENTE, anonimizarPorSql, bloquear, criarCenario, hora, inserirCliente, reservar } from './apoio';

// D-028 T-4/T-6: as duas páginas com sessões reais no PostgreSQL (CA-1, 3, 5, 10, 11, 14, 15, 17).
// next/headers (cookies) e next/navigation (redirect, notFound) são substituídos; o banco é real.
// O relógio da página é o real: as reservas ficam em "hoje" (data local de São Paulo) pela própria data.

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

let c: pg.Client;
let x: CenarioReserva;
let y: CenarioReserva;
let rAna: string;
let rBia: string;
let rAnonima: string;
let rY: string;
const DIA = '2026-12-01';

beforeAll(async () => {
  c = await conectar();
  x = await criarCenario();
  y = await criarCenario();
  const cli = await inserirCliente(c, x.s.salaoId, 'Maria Souza', '+5511977770001');
  rAna = await reservar(c, x, { profissionalId: x.ana, inicio: new Date('2026-12-01T12:00:00Z'), clienteId: cli });
  rBia = await reservar(c, x, { profissionalId: x.bia, inicio: hora('14:00'), clienteId: cli, status: 'cancelado' });
  const sumida = await inserirCliente(c, x.s.salaoId, 'Fulana Sumida', '+5511977770002');
  rAnonima = await reservar(c, x, { profissionalId: x.ana, inicio: hora('16:00'), clienteId: sumida, status: 'nao_compareceu' });
  await anonimizarPorSql(c, sumida);
  await bloquear(c, x.s.salaoId, { profissionalId: x.ana, inicio: hora('13:00'), fim: hora('14:00'), motivo: 'Dentista' });
  rY = await reservar(c, y, { profissionalId: y.ana, inicio: hora('10:00') });
});
afterAll(async () => {
  await c.end();
});
beforeEach(() => {
  estadoNext.cookie = undefined;
});
afterEach(() => {
  vi.restoreAllMocks();
});

const comoGestor = async (s: CenarioReserva) => {
  estadoNext.cookie = (await criarSessao(s.s.gestor.usuarioId)).token;
};
const comoProfissional = async (s: CenarioReserva) => {
  estadoNext.cookie = (await criarSessao(s.s.profissional.usuarioId)).token;
};
const agenda = async (params: Record<string, string | string[]> = { data: DIA }) =>
  renderToStaticMarkup(await PaginaAgenda({ searchParams: Promise.resolve(params) }));
const reserva = async (id: string) => renderToStaticMarkup(await PaginaReserva({ params: Promise.resolve({ id }) }));

async function destinoDe(p: Promise<unknown>): Promise<string> {
  const e = await p.then(
    () => {
      throw new Error('esperava redirect');
    },
    (x2: unknown) => x2,
  );
  expect(e).toBeInstanceOf(Redirecionado);
  return (e as Redirecionado).destino;
}

describe('sem sessão', () => {
  it('redireciona para /entrar?proximo= (agenda e detalhe)', async () => {
    expect(await destinoDe(agenda())).toBe(`/entrar?proximo=${encodeURIComponent(ROTAS.agenda)}`);
    expect(await destinoDe(reserva(rAna))).toBe(`/entrar?proximo=${encodeURIComponent(ROTAS.agendaReserva(rAna))}`);
  });
});

describe('gestor', () => {
  it('agenda do dia: 09:00 em São Paulo (CA-3), nomes, status, bloqueio, cliente removida e nenhum telefone (CA-5, CA-17)', async () => {
    await comoGestor(x);
    const html = await agenda();
    expect(html).toContain('Terça-feira, 01/12/2026');
    expect(html).toContain('09:00–10:00');
    expect(html).toContain('Maria Souza');
    expect(html).toContain('Confirmada');
    expect(html).toContain('Cancelada');
    expect(html).toContain('Não compareceu');
    expect(html).toContain('cliente removida');
    expect(html).not.toContain('Fulana Sumida');
    expect(html).toContain('Bloqueio: Dentista');
    expect(html).toContain(`href="${ROTAS.agendaReserva(rAna)}"`);
    expect(html).toContain('Todos os profissionais');
    expect(html).not.toMatch(/5511977770001|\(11\) 97777/);
    expect(html).not.toContain(rY);
  });

  it('semana e filtro por profissional (CA-14); parâmetros repetidos valem como ausentes (CA-15)', async () => {
    await comoGestor(x);
    const semana = await agenda({ data: DIA, visao: 'semana' });
    expect(semana).toContain('Semana de 29/11/2026 a 05/12/2026');
    const bia = await agenda({ data: DIA, profissional: x.bia });
    expect(bia).toContain(`href="${ROTAS.agendaReserva(rBia)}"`);
    expect(bia).not.toContain(rAna);
    const repetido = await agenda({ data: [DIA, '2026-12-05'], visao: ['semana', 'dia'], profissional: [x.bia, x.ana] });
    expect(repetido).toContain(ROTAS.agenda);
    expect(repetido).not.toContain('Semana de');
    expect(repetido).toContain('Todos os profissionais');
  });

  it('data e visão malformadas: página normal, sem 500 (CA-15)', async () => {
    await comoGestor(x);
    const html = await agenda({ data: 'lixo', visao: 'xyz' });
    expect(html).toContain('<h1>Agenda</h1>');
  });

  it('profissional malformado, inexistente ou de outro salão → 404 (RN-12)', async () => {
    await comoGestor(x);
    for (const profissional of ['lixo', UUID_INEXISTENTE, y.ana]) {
      await expect(agenda({ data: DIA, profissional })).rejects.toThrow('NEXT_NOT_FOUND');
    }
  });

  it('detalhe: telefone formatado, horário no fuso, itens, total e link de volta ao dia', async () => {
    await comoGestor(x);
    const html = await reserva(rAna);
    expect(html).toContain('<h1>Reserva</h1>');
    expect(html).toContain('(11) 97777-0001');
    expect(html).toContain('01/12/2026 09:00');
    expect(html).toMatch(/R\$\s*50,00/);
    expect(html).toContain(`href="${ROTAS.agenda}?data=2026-12-01"`);
    const removida = await reserva(rAnonima);
    expect(removida).toContain('cliente removida');
    expect(removida).not.toMatch(/Fulana|5511977770002|Telefone/);
    expect(removida).toMatch(/R\$\s*50,00/);
  });

  it('detalhe de outro salão, inexistente ou malformado → 404 (CA-11)', async () => {
    await comoGestor(x);
    for (const id of [rY, UUID_INEXISTENTE, 'lixo']) {
      await expect(reserva(id)).rejects.toThrow('NEXT_NOT_FOUND');
    }
  });
});

describe('profissional', () => {
  it('só a própria agenda; a reserva de outra profissional é 404 (CA-1)', async () => {
    await comoProfissional(x);
    const html = await agenda({ data: DIA, profissional: x.bia });
    expect(html).toContain(`href="${ROTAS.agendaReserva(rAna)}"`);
    expect(html).not.toContain(rBia);
    expect(html).not.toContain('Todos os profissionais');
    expect(html).not.toContain('<select');
    expect(await reserva(rAna)).toContain('(11) 97777-0001');
    await expect(reserva(rBia)).rejects.toThrow('NEXT_NOT_FOUND');
    await expect(reserva(rY)).rejects.toThrow('NEXT_NOT_FOUND');
  });
});

describe('CA-10: salão suspenso', () => {
  it('a agenda e o detalhe abrem normalmente', async () => {
    const s = await criarCenario();
    const id = await reservar(c, s, { profissionalId: s.ana, inicio: new Date('2026-12-01T12:00:00Z') });
    await c.query('UPDATE salao SET suspenso_manual_em = now() WHERE id = $1', [s.s.salaoId]);
    await definirAssinatura(s.s.salaoId, 'suspensa');
    await comoGestor(s);
    expect(await agenda()).toContain('09:00–10:00');
    expect(await reserva(id)).toContain('<h1>Reserva</h1>');
    await comoProfissional(s);
    expect(await agenda()).toContain('09:00–10:00');
  });
});

describe('D-043: situação das mensagens no detalhe e marca na grade', () => {
  const botoes = (html: string) => (html.match(/<button[^>]*>[^<]*<\/button>/g) ?? []).join('|');

  it('CA-1/CA-5/CA-7: a falha aparece no detalhe e na grade sem mudar as ações nem vazar valores internos', async () => {
    const s = await criarCenario();
    const id = await reservar(c, s, { profissionalId: s.ana, inicio: new Date('2026-12-01T12:00:00Z') });
    await comoGestor(s);
    const antes = await reserva(id);
    expect(antes).toContain('Nenhuma mensagem de WhatsApp para esta reserva.');
    expect(botoes(antes)).not.toBe('');
    const m = await criarMensagem({
      salaoId: s.s.salaoId, reservaId: id, tipo: 'confirmacao', estado: 'falhou', erroCodigo: 'SENTINELA_CODIGO',
      destinatarioE164: '+5511987650999', provedorMensagemId: 'wamid.SENTINELA_PROVEDOR',
      atualizadoEm: new Date('2026-11-22T14:35:00Z'), tentativas: [{ resultado: 'falha', iniciadaEm: new Date('2026-11-22T14:35:00Z') }],
    });
    await c.query(`UPDATE mensagem_tentativa SET erro_detalhe = 'SENTINELA_DETALHE' WHERE mensagem_id = $1`, [m]);
    for (const entrar of [comoGestor, comoProfissional]) {
      await entrar(s);
      const html = await reserva(id);
      expect(html).toContain('Mensagens de WhatsApp');
      expect(html).toContain('Falha ao enviar confirmação por WhatsApp');
      expect(html).toContain('Última tentativa: 22/11/2026 11:35');
      expect(html).not.toMatch(/SENTINELA|987650999|wamid/);
      expect(botoes(html)).toBe(botoes(antes));
      expect(html.indexOf('Serviços')).toBeLessThan(html.indexOf('Mensagens de WhatsApp'));
    }
    await comoGestor(s);
    expect(await agenda({ data: DIA })).toContain('Falha ao enviar mensagem');
    expect(await agenda({ data: DIA, visao: 'semana' })).toContain('Falha ao enviar mensagem');
    const { rows } = await c.query<{ status: string }>('SELECT status::text AS status FROM reserva WHERE id = $1', [id]);
    expect(rows[0].status).toBe('confirmado');
  });

  it('CA-3: profissional A não vê as mensagens da reserva do B (404, igual a inexistente)', async () => {
    await criarMensagem({ salaoId: x.s.salaoId, reservaId: rBia, estado: 'enviada' });
    await comoProfissional(x);
    await expect(reserva(rBia)).rejects.toThrow('NEXT_NOT_FOUND');
    await expect(reserva(UUID_INEXISTENTE)).rejects.toThrow('NEXT_NOT_FOUND');
    await comoGestor(y);
    await expect(reserva(rBia)).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('CA-11/CA-12: salão suspenso e cliente anonimizada continuam mostrando as mensagens', async () => {
    const s = await criarCenario();
    const cli = await inserirCliente(c, s.s.salaoId, 'Fulana Sumida', '+5511977770055');
    const id = await reservar(c, s, { profissionalId: s.ana, inicio: new Date('2026-12-01T12:00:00Z'), clienteId: cli });
    await criarMensagem({ salaoId: s.s.salaoId, reservaId: id, estado: 'cancelada_anonimizacao' });
    await anonimizarPorSql(c, cli);
    await c.query('UPDATE salao SET suspenso_manual_em = now() WHERE id = $1', [s.s.salaoId]);
    await definirAssinatura(s.s.salaoId, 'suspensa');
    await comoGestor(s);
    const html = await reserva(id);
    expect(html).toContain('Confirmação não enviada');
    expect(html).toContain('Cliente removida; a mensagem foi cancelada.');
    expect(html).not.toMatch(/Fulana|977770055/);
  });
});
