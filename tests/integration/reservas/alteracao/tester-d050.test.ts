import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { remarcarAcao } from '@/app/painel/agenda/reservas/[id]/acoes';
import { estadoRemarcarInicial } from '@/app/painel/agenda/reservas/[id]/estado';
import PaginaReserva from '@/app/painel/agenda/reservas/[id]/page';
import { ROTAS } from '@/config/navegacao';

import { criarSessao } from '../../../support/auth';

import { conferirDerivados, criarCenario, criarComItens, db, itemDe, mensagensDe, reservaDe } from './apoio';
import type { Cenario } from './apoio';

// D-050 — testes do TESTER (independentes do desenvolvedor). Sondagens:
//  (1) remarcar um item cujo profissional foi desativado (DEF-1; rodada 2: o gestor precisa escolher a profissional);
//  (2) CA-33: o HTML do detalhe para a profissional não contém nome, horário nem preço dos itens alheios,
//      inclusive em campos ocultos, confirmações e na seção de mensagens.

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

const DATA = { ano: 2027, mes: 3, dia: 9 } as const; // terça; dentro de hoje ± 5 anos da agenda

beforeEach(() => {
  estadoNext.cookie = undefined;
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

const comoGestor = async (c: Cenario) => {
  estadoNext.cookie = (await criarSessao(c.s.gestor.usuarioId)).token;
};
const comoProfissional = async (c: Cenario) => {
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
const form = (campos: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) fd.append(k, v);
  return fd;
};

/** Primeira <option> do <select name="profissionalId"> e a marcada como selected (se houver). */
function selectDeProfissional(html: string) {
  const m = html.match(/<select[^>]*name="profissionalId"[^>]*>([\s\S]*?)<\/select>/);
  if (!m) return null;
  const opcoes = [...m[1].matchAll(/<option([^>]*)value="([^"]*)"([^>]*)>([^<]*)<\/option>/g)].map((o) => ({
    valor: o[2],
    rotulo: o[4],
    selecionada: /selected/.test(o[1] + o[3]),
  }));
  return opcoes;
}

describe('TESTER D-050: remarcar item de profissional desativado (DEF-1, rodada 2: corrigido)', () => {
  it('o formulário do gestor abre com "Escolha a profissional" selecionada e a ajuda; vazio/ausente é recusado sem gravar; escolhendo uma ativa, remarca', async () => {
    const c = await criarCenario();
    const r = await criarComItens(c, [
      { servicoId: c.A, profissionalId: c.ana, hora: '10:00', data: DATA },
      { servicoId: c.C, profissionalId: c.bia, hora: '10:30', data: DATA },
    ]);
    const [, itemBia] = r.itens;
    // Bia desativada depois da reserva (corrida aceita ou item passado não marcado: a desativação comum é recusada).
    await db().profissional.update({ where: { id: c.bia }, data: { ativo: false } });

    await comoGestor(c);
    const html = await pagina(r.id, { remarcar: itemBia });
    const opcoes = selectDeProfissional(html);
    expect(opcoes).not.toBeNull();
    // A 1ª opção é a vazia, e é a ÚNICA selecionada; a inativa não é oferecida.
    expect(opcoes![0]).toEqual({ valor: '', rotulo: 'Escolha a profissional', selecionada: true });
    expect(opcoes!.filter((o) => o.selecionada)).toHaveLength(1);
    expect(opcoes!.some((o) => o.valor.toLowerCase() === c.bia.toLowerCase())).toBe(false);
    expect(html.slice(html.indexOf('<h3 id="remarcar"'))).toContain('Atual: Bia (inativo).');

    const estado = estadoRemarcarInicial(itemBia, { servicoId: c.C, profissionalId: '', data: '', hora: '10:30', confirmarEncaixe: false });
    const antes = await itemDe(itemBia);
    const mensagensAntes = await mensagensDe(r.id);
    // O que o navegador envia sem o gestor escolher (vazio) e um POST forjado sem o campo: erro de campo, nada gravado.
    const envios: Record<string, string>[] = [
      { reservaId: r.id, itemId: itemBia, servicoId: c.C, profissionalId: '', hora: '11:00', de: '10:30' },
      { reservaId: r.id, itemId: itemBia, servicoId: c.C, hora: '11:00', de: '10:30' },
    ];
    for (const campos of envios) {
      const resp = await remarcarAcao(estado, form(campos));
      expect(resp.erros?.profissional).toBe('Escolha a profissional.');
      expect(await itemDe(itemBia)).toEqual(antes);
      expect((await reservaDe(r.id)).revisao).toBe(0);
      expect(await mensagensDe(r.id)).toEqual(mensagensAntes);
    }
    // Escolha consciente de uma ativa: PRG normal, item com a Ana, remarcação registrada.
    const destino = await destinoDe(
      remarcarAcao(estado, form({ reservaId: r.id, itemId: itemBia, servicoId: c.C, profissionalId: c.ana, hora: '11:00', de: '10:30' })),
    );
    expect(destino).toContain('resultado=remarcado');
    expect((await itemDe(itemBia)).profissionalId.toLowerCase()).toBe(c.ana.toLowerCase());
    expect((await reservaDe(r.id)).revisao).toBe(1);
    expect((await mensagensDe(r.id)).some((m) => m.tipo === 'remarcacao' && m.reservaItemId === itemBia)).toBe(true);
    await conferirDerivados(r.id);
  });

  it('com a profissional atual ATIVA nada muda: sem opção vazia, a atual selecionada', async () => {
    const c = await criarCenario();
    const r = await criarComItens(c, [{ servicoId: c.C, profissionalId: c.bia, hora: '10:30', data: DATA }]);
    await comoGestor(c);
    const opcoes = selectDeProfissional(await pagina(r.id, { remarcar: r.itens[0] }))!;
    expect(opcoes.some((o) => o.valor === '')).toBe(false);
    expect(opcoes.filter((o) => o.selecionada).map((o) => o.valor.toLowerCase())).toEqual([c.bia.toLowerCase()]);
  });

  it('enviar explicitamente a profissional inativa é recusado sem gravar', async () => {
    const c = await criarCenario();
    const r = await criarComItens(c, [{ servicoId: c.C, profissionalId: c.bia, hora: '10:30', data: DATA }]);
    const [itemBia] = r.itens;
    await db().profissional.update({ where: { id: c.bia }, data: { ativo: false } });
    await comoGestor(c);
    const estado = estadoRemarcarInicial(itemBia, { servicoId: c.C, profissionalId: c.bia, data: '', hora: '10:30', confirmarEncaixe: false });
    const resp = await remarcarAcao(estado, form({ reservaId: r.id, itemId: itemBia, servicoId: c.C, profissionalId: c.bia, hora: '11:00', de: '10:30' }));
    expect(resp.mensagem ?? (resp as { erros?: Record<string, string> }).erros?.profissional).toBeTruthy();
    expect((await itemDe(itemBia)).profissionalId.toLowerCase()).toBe(c.bia.toLowerCase());
    expect((await reservaDe(r.id)).revisao).toBe(0);
  });
});

describe('TESTER D-050: CA-33, HTML da profissional sem dados dos itens alheios', () => {
  it('nome, horário e preço dos itens da Bia não aparecem em nenhuma vista do detalhe para a Ana', async () => {
    const c = await criarCenario();
    // Nomes e preços inconfundíveis para o serviço da Bia.
    await db().servico.update({ where: { id: c.C }, data: { nome: 'ServicoSigilosoX', precoCentavos: 98765 } });
    const r = await criarComItens(c, [
      { servicoId: c.A, profissionalId: c.ana, hora: '10:00', data: DATA },
      { servicoId: c.C, profissionalId: c.bia, hora: '13:35', data: DATA },
    ]);
    const [itemAna, itemBia] = r.itens;
    // Uma mensagem do item da Bia (cancelamento pelo gestor) para a seção de mensagens.
    await comoGestor(c);
    const { cancelarAcao } = await import('@/app/painel/agenda/reservas/[id]/acoes');
    const { estadoDoItemInicial } = await import('@/app/painel/agenda/reservas/[id]/estado');
    await destinoDe(cancelarAcao(estadoDoItemInicial, form({ reservaId: r.id, itemId: itemBia })));

    await comoProfissional(c);
    const vistas = [
      {},
      { remarcar: itemAna },
      { cancelar: itemAna },
      { cancelar: 'todos' },
      { remarcar: itemBia },
      { cancelar: itemBia },
      { resultado: 'cancelado', item: itemBia },
      { resultado: 'remarcado', item: itemBia, de: '13:35' },
    ];
    for (const busca of vistas) {
      const html = await pagina(r.id, busca as Record<string, string>);
      expect(html, JSON.stringify(busca)).toContain(`id="item-${itemAna}"`);
      // Com o remarcar aberto, o select de serviço lista o CATÁLOGO do salão (nome e preço do serviço, não do item).
      if (!('remarcar' in busca)) {
        expect(html, JSON.stringify(busca)).not.toContain('ServicoSigilosoX');
        expect(html, JSON.stringify(busca)).not.toContain('987,65');
      }
      expect(html, JSON.stringify(busca)).not.toContain('13:35');
      expect(html, JSON.stringify(busca)).not.toContain('Bia');
      expect(html, JSON.stringify(busca)).not.toContain(itemBia);
    }
  });

  it('agenda do dia da profissional: sem o serviço, a hora e o item da Bia', async () => {
    const c = await criarCenario();
    await db().servico.update({ where: { id: c.C }, data: { nome: 'ServicoSigilosoX', precoCentavos: 98765 } });
    const r = await criarComItens(c, [
      { servicoId: c.A, profissionalId: c.ana, hora: '10:00', data: DATA },
      { servicoId: c.C, profissionalId: c.bia, hora: '13:35', data: DATA },
    ]);
    await comoProfissional(c);
    const PaginaAgenda = (await import('@/app/painel/agenda/page')).default;
    const html = renderToStaticMarkup(
      await PaginaAgenda({ searchParams: Promise.resolve({ data: '2027-03-09', visao: 'semana' }) } as never),
    );
    const htmlDia = renderToStaticMarkup(await PaginaAgenda({ searchParams: Promise.resolve({ data: '2027-03-09' }) } as never));
    for (const h of [html, htmlDia]) {
      expect(h).toContain(ROTAS.agendaReserva(r.id));
      expect(h).not.toContain('ServicoSigilosoX');
      expect(h).not.toContain('13:35');
      expect(h).not.toContain(r.itens[1]);
    }
  });
});

describe('TESTER D-050: caso limite 2 — "Cancelar todos" × cancelar um item, em paralelo (10 vezes)', () => {
  it('serializados; cada item cancelado é citado por exatamente UMA mensagem de cancelamento; revisões distintas', async () => {
    const { cancelarItem } = await import('@/server/reservas/cancelar');
    const { cancelarTodos } = await import('@/server/reservas/cancelar-todos');
    const { AGORA } = await import('./apoio');
    const c = await criarCenario();
    const deps = { enfileirar: async () => ({ criado: true as const, id: 'job' }) };
    const desfechos = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const data = { ano: 2027, mes: 4, dia: 1 + i };
      const r = await criarComItens(c, [
        { servicoId: c.A, profissionalId: c.ana, hora: '10:00', data },
        { servicoId: c.C, profissionalId: c.bia, hora: '11:00', data },
        { servicoId: c.B, profissionalId: c.ana, hora: '15:00', data },
      ]);
      const [x] = r.itens;
      const [todos, um] = await Promise.all([
        cancelarTodos(c.ctxEquipe, { reservaId: r.id }, AGORA, deps),
        cancelarItem(c.ctxEquipe, { reservaId: r.id, itemId: x }, AGORA, deps),
      ]);
      desfechos.add(`${todos.resultado}/${um.resultado}`);
      expect(todos.resultado).toBe('atualizada');
      const reserva = await reservaDe(r.id);
      expect(reserva.status).toBe('cancelado');
      expect(reserva.itens.every((it) => it.status === 'cancelado')).toBe(true);
      const cancelamentos = (await mensagensDe(r.id)).filter((m) => m.tipo === 'cancelamento');
      // Cada item cancelado tem a revisão da operação que o cancelou: mensagem do item OU a sem item, nunca as duas.
      const revisoes = new Set(cancelamentos.map((m) => m.revisao));
      expect(revisoes.size).toBe(cancelamentos.length);
      for (const it of reserva.itens) {
        const citam = cancelamentos.filter((m) => (m.reservaItemId === null ? m.revisao === it.revisao : m.reservaItemId === it.id));
        expect(citam, `item ${it.id}`).toHaveLength(1);
      }
      if (um.resultado === 'atualizada') {
        expect(cancelamentos).toHaveLength(2);
        expect(reserva.revisao).toBe(2);
      } else {
        expect(cancelamentos).toHaveLength(1);
        expect(reserva.revisao).toBe(1);
      }
      await conferirDerivados(r.id);
    }
    console.log('[TESTER] desfechos =', [...desfechos].join(', '));
  });
});
