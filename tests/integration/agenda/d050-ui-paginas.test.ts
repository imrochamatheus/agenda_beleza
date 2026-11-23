import type pg from 'pg';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import PaginaAgenda from '@/app/painel/agenda/page';
import PaginaReserva from '@/app/painel/agenda/reservas/[id]/page';
import { ROTAS } from '@/config/navegacao';

import { criarSessao } from '../../support/auth';
import { criarMensagem } from '../../support/mensagens';
import type { CenarioReserva } from '../../support/reservas';
import { conectar } from '../../support/sql';

import { criarCenario, hora, reservarComItens } from './apoio';

// D-050 T-13 (web-design §5.9–5.10, critérios 17–20; CA-32, CA-33, CA-34): agenda e detalhe com a reserva do
// exemplo (Escova com a Ana, Hidratação com a Bia, Manicure com a Carla), sessões reais e PostgreSQL real.

const estadoNext = vi.hoisted(() => ({ cookie: undefined as string | undefined }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (nome: string) => (nome === 'ab_sessao' && estadoNext.cookie !== undefined ? { name: nome, value: estadoNext.cookie } : undefined),
  }),
}));
vi.mock('next/navigation', () => ({
  redirect: (destino: string) => {
    throw new Error(`NEXT_REDIRECT ${destino}`);
  },
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  usePathname: () => null,
}));

let c: pg.Client;
let x: CenarioReserva;
let reservaId: string;
let itens: string[];
let carla: string;
const DIA = '2026-12-01';

beforeAll(async () => {
  c = await conectar();
  x = await criarCenario();
  const salao = x.s.salaoId;
  carla = (await c.query<{ id: string }>(`INSERT INTO profissional (salao_id, nome) VALUES ($1, 'Carla') RETURNING id::text AS id`, [salao])).rows[0].id;
  const servico = async (nome: string, preco: number, duracao: number) =>
    (await c.query<{ id: string }>('INSERT INTO servico (salao_id, nome, preco_centavos, duracao_min) VALUES ($1, $2, $3, $4) RETURNING id::text AS id', [salao, nome, preco, duracao])).rows[0].id;
  const escova = await servico('Escova', 9000, 60);
  const hidratacao = await servico('Hidratação', 7500, 40);
  const manicure = await servico('Manicure', 4000, 45);
  ({ reservaId, itemIds: itens } = await reservarComItens(c, x, {
    profissionalId: x.ana,
    inicio: hora('09:00'),
    itens: [
      { servicoId: escova, precoCentavos: 9000, duracaoMin: 60, profissionalId: x.ana, inicio: hora('09:00') },
      { servicoId: hidratacao, precoCentavos: 7500, duracaoMin: 40, profissionalId: x.bia, inicio: hora('10:00') },
      { servicoId: manicure, precoCentavos: 4000, duracaoMin: 45, profissionalId: carla, inicio: hora('15:00'), encaixe: true },
    ],
  }));
});
afterAll(async () => {
  await c.end();
});
beforeEach(() => {
  estadoNext.cookie = undefined;
});

const comoGestor = async () => {
  estadoNext.cookie = (await criarSessao(x.s.gestor.usuarioId)).token;
};
/** Usuário de papel profissional, vinculado à Ana. */
const comoAna = async () => {
  estadoNext.cookie = (await criarSessao(x.s.profissional.usuarioId)).token;
};
const agenda = async (params: Record<string, string> = { data: DIA }) => renderToStaticMarkup(await PaginaAgenda({ searchParams: Promise.resolve(params) }));
const detalhe = async (busca: Record<string, string> = {}) =>
  renderToStaticMarkup(await PaginaReserva({ params: Promise.resolve({ id: reservaId }), searchParams: Promise.resolve(busca) }));

/** Trecho do HTML do link de um bloco (do `<a` ao `</a>`), pelo item. */
function bloco(html: string, itemId: string): string {
  const fim = html.indexOf(`#item-${itemId}"`);
  expect(fim).toBeGreaterThan(-1);
  const inicio = html.lastIndexOf('<a ', fim);
  return html.slice(inicio, html.indexOf('</a>', fim) + 4);
}
const texto = (h: string) => h.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

describe('agenda do dia (critério 17)', () => {
  it('gestor: 3 blocos, um em cada coluna, com serviço, status no masculino e "n de 3"', async () => {
    await comoGestor();
    const html = await agenda();
    const [escova, hidratacao, manicure] = itens.map((i) => texto(bloco(html, i)));
    expect(escova).toBe('09:00–10:00 Cliente da Agenda · Escova · Confirmado · 1 de 3serviço 1 de 3 do agendamento');
    expect(hidratacao).toBe('10:00–10:40 Cliente da Agenda · Hidratação · Confirmado · 2 de 3serviço 2 de 3 do agendamento');
    expect(manicure).toBe('15:00–15:45 Cliente da Agenda · Manicure · Confirmado · Encaixe · 3 de 3serviço 3 de 3 do agendamento');
    for (const i of itens) expect(html).toContain(`href="${ROTAS.agendaReserva(reservaId)}#item-${i}"`);
    // Cada bloco na coluna do profissional do item.
    const coluna = (id: string) => html.slice(html.indexOf(`id="coluna-${id}"`));
    expect(coluna(x.bia).indexOf(`#item-${itens[1]}`)).toBeGreaterThan(-1);
    expect(coluna(carla).indexOf(`#item-${itens[2]}`)).toBeGreaterThan(-1);
    // Altura pela duração DO ITEM (0,1 rem/min).
    expect(bloco(html, itens[1])).toContain('height:4.00rem');
    expect(bloco(html, itens[2])).toContain('height:4.50rem');
  });

  it('profissional: só o próprio bloco, sem marcador e sem os serviços das outras (CA-33)', async () => {
    await comoAna();
    const html = await agenda();
    expect(texto(bloco(html, itens[0]))).toBe('09:00–10:00 Cliente da Agenda · Escova · Confirmado');
    expect(html).not.toMatch(/Hidratação|Manicure|de 3/);
    expect(html).not.toContain(itens[1]);
    expect(html).not.toContain(itens[2]);
  });

  it('falha de mensagem vigente: marca em TODOS os blocos da reserva, sem mudar a altura (critério 18)', async () => {
    const s = await criarCenario();
    const { reservaId: id, itemIds } = await reservarComItens(c, s, {
      profissionalId: s.ana,
      inicio: hora('09:00'),
      itens: [
        { servicoId: s.A, precoCentavos: 5000, duracaoMin: 30, profissionalId: s.ana, inicio: hora('09:00') },
        { servicoId: s.B, precoCentavos: 7000, duracaoMin: 45, profissionalId: s.bia, inicio: hora('09:30') },
      ],
    });
    await criarMensagem({ salaoId: s.s.salaoId, reservaId: id, tipo: 'confirmacao', estado: 'falhou' });
    estadoNext.cookie = (await criarSessao(s.s.gestor.usuarioId)).token;
    const html = await agenda();
    for (const [i, altura] of [[itemIds[0], '3.00rem'], [itemIds[1], '4.50rem']] as const) {
      const b = bloco(html, i);
      expect(texto(b)).toMatch(/^Falha ao enviar mensagem\./);
      expect(b).toContain(`height:${altura}`);
    }
  });
});

describe('detalhe (critérios 19 e 20)', () => {
  it('gestor: dl com Data, roteiro com os 3 serviços, profissional por item e total', async () => {
    await comoGestor();
    const html = await detalhe();
    expect(html).toContain('<dt>Data</dt><dd>Terça-feira, 01/12/2026</dd>');
    expect(html).not.toMatch(/<dt>(Profissional|Início|Fim)<\/dt>/);
    for (const i of itens) expect(html).toContain(`id="item-${i}"`);
    expect(html).toContain('com Ana · 1 h');
    expect(html).toContain('com Bia · 40 min');
    expect(html).toContain('com Carla · 45 min');
    expect(html).toMatch(/<span>Total<\/span> <strong>R\$\s*205,00<\/strong> · 3 serviços/);
    expect(html).not.toContain('Itens cancelados não entram no total.');
  });

  it('item cancelado: parada riscável, etiqueta "Cancelado", fora do total e com a nota', async () => {
    const s = await criarCenario();
    const { reservaId: id } = await reservarComItens(c, s, {
      profissionalId: s.ana,
      inicio: hora('09:00'),
      itens: [
        { servicoId: s.A, precoCentavos: 5000, duracaoMin: 30, inicio: hora('09:00') },
        { servicoId: s.B, precoCentavos: 7000, duracaoMin: 45, inicio: hora('10:00'), status: 'cancelado' },
      ],
    });
    estadoNext.cookie = (await criarSessao(s.s.gestor.usuarioId)).token;
    const html = renderToStaticMarkup(await PaginaReserva({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) }));
    expect(html).toMatch(/data-estado="cancelada"/);
    expect(html).toContain('>Cancelado<');
    expect(html).toMatch(/<span>Total<\/span> <strong>R\$\s*50,00<\/strong> · 1 serviço</);
    expect(html).toContain('Itens cancelados não entram no total.');
  });

  it('profissional: só os próprios itens, a frase e o total dos seus serviços (CA-33)', async () => {
    await comoAna();
    const html = await detalhe();
    expect(html).toContain('Você vê apenas os seus serviços nesta reserva.');
    expect(html).toContain(`id="item-${itens[0]}"`);
    expect(html).not.toMatch(/Hidratação|Manicure|com Bia|com Carla/);
    expect(html).toMatch(/<span>Total dos seus serviços<\/span> <strong>R\$\s*90,00<\/strong> · 1 serviço</);
  });
});
