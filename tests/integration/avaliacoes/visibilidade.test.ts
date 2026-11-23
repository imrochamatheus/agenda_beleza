import type pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { anonimizarCliente } from '@/server/clientes/anonimizar';
import { lerAvaliacoesPublicas } from '@/server/avaliacoes/leitura';
import { verificarLink } from '@/server/avaliacoes/servico';
import { lerPublicas } from '@/server/repos/avaliacao-publica';

import type { SalaoCompleto } from '../../support/factories';
import { ipNovo } from '../../support/reserva-publica';
import { conectar, inserirReserva } from '../../support/sql';
import { ctxDoGestor } from '../clientes/apoio';

import { AGORA, DIA_MS, conviteDe, criarAvaliavel, ctxPublico, definirStatus, emitirLink, enviar, salaoNovo } from './apoio';

// D-032 T-4/T-5: visibilidade derivada (CA-7, CA-8, CA-11, CA-15) e o gancho da anonimização.
let c: pg.Client;

beforeAll(async () => {
  c = await conectar();
});
afterAll(async () => {
  await c.end();
});
beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

async function avaliar(s: SalaoCompleto, nota: number, nome = 'Ana Lima', comentario = 'Bom') {
  const k = await criarAvaliavel(c, s, { nome });
  const { token } = await emitirLink(s, k.reservaId);
  const r = await enviar(s, token, { nota: String(nota), comentario });
  expect(r).toEqual({ resultado: 'enviada' });
  return { ...k, token };
}

describe('CA-15: sem avaliações e agregados', () => {
  it('salão sem avaliações: total 0, média nula, lista vazia', async () => {
    const s = await salaoNovo();
    expect(await lerAvaliacoesPublicas(ctxPublico(s))).toEqual({ total: 0, media: null, itens: [] });
  });

  it('média com 1 casa (meio para cima), contagem e as 10 mais recentes primeiro', async () => {
    const s = await salaoNovo();
    // 5,5,4 = 4,67 -> 4,7 ; depois mais uma 4 => 18/4 = 4,5
    const ids = [await avaliar(s, 5, 'A Um'), await avaliar(s, 5, 'B Dois'), await avaliar(s, 4, 'C Tres')];
    expect(await lerAvaliacoesPublicas(ctxPublico(s))).toMatchObject({ total: 3, media: 4.7 });
    ids.push(await avaliar(s, 4, 'D Quatro'));
    // Instantes distintos (o relógio injetado dá o mesmo a todas): a ordem é por criado_em decrescente.
    for (const [i, k] of ids.entries()) {
      await c.query('UPDATE avaliacao SET criado_em = $2 WHERE reserva_id = $1', [k.reservaId, new Date(AGORA.getTime() + i * 60_000)]);
    }
    const r = await lerAvaliacoesPublicas(ctxPublico(s));
    expect(r).toMatchObject({ total: 4, media: 4.5 });
    expect(r.itens.map((i) => i.nome)).toEqual(['D Q.', 'C T.', 'B D.', 'A U.']);
  });

  it('arredondamento meio-para-cima: 4,25 vira 4,3; 3,35 não depende de ponto flutuante', async () => {
    const s = await salaoNovo();
    for (const n of [5, 4, 4, 4]) await avaliar(s, n); // 17/4 = 4,25
    expect((await lerAvaliacoesPublicas(ctxPublico(s))).media).toBe(4.3);
  });

  it('a lista traz no máximo o limite, mas total e média cobrem todas', async () => {
    const s = await salaoNovo();
    for (let i = 0; i < 12; i += 1) await avaliar(s, 5);
    const r = await lerAvaliacoesPublicas(ctxPublico(s));
    expect(r.total).toBe(12);
    expect(r.itens).toHaveLength(10);
    expect(await lerPublicas(ctxPublico(s), 3).then((x) => x.itens.length)).toBe(3);
  });
});

describe('CA-11: isolamento entre salões', () => {
  it('avaliações de um salão não aparecem nem entram nos agregados do outro', async () => {
    const a = await salaoNovo();
    const b = await salaoNovo();
    await avaliar(a, 5, 'Só Salão');
    await avaliar(a, 5);
    await avaliar(b, 1, 'Outra Pessoa');
    const ra = await lerAvaliacoesPublicas(ctxPublico(a));
    const rb = await lerAvaliacoesPublicas(ctxPublico(b));
    expect([ra.total, ra.media]).toEqual([2, 5]);
    expect([rb.total, rb.media]).toEqual([1, 1]);
    expect(rb.itens.map((i) => i.nome)).toEqual(['Outra P.']);
  });
});

describe('CA-7: reserva nao_compareceu oculta e a volta reexibe', () => {
  it('oculta da lista e dos agregados; link não usado é recusado e volta a valer; nenhuma mensagem nova', async () => {
    const s = await salaoNovo();
    const a = await avaliar(s, 2, 'Ocultar Esta');
    await avaliar(s, 4);
    const pendente = await criarAvaliavel(c, s);
    const { token: tPendente } = await emitirLink(s, pendente.reservaId);
    const mensagensAntes = (await c.query('SELECT count(*) AS n FROM mensagem WHERE salao_id = $1', [s.salaoId])).rows[0].n;

    for (const id of [a.reservaId, pendente.reservaId]) await definirStatus(c, id, 'nao_compareceu');
    const oculta = await lerAvaliacoesPublicas(ctxPublico(s));
    expect([oculta.total, oculta.media]).toEqual([1, 4]);
    expect(oculta.itens.some((i) => i.nome === 'Ocultar E.')).toBe(false);
    expect(await verificarLink(s.slugAtual, tPendente, ipNovo(), AGORA)).toEqual({ ok: false, motivo: 'invalido' });
    expect(await enviar(s, tPendente)).toEqual({ resultado: 'link_invalido' });
    // A avaliação continua gravada (só oculta).
    expect((await c.query('SELECT count(*) AS n FROM avaliacao WHERE reserva_id = $1', [a.reservaId])).rows[0].n).toBe('1');

    for (const id of [a.reservaId, pendente.reservaId]) await definirStatus(c, id, 'concluido');
    const volta = await lerAvaliacoesPublicas(ctxPublico(s));
    expect([volta.total, volta.media]).toEqual([2, 3]);
    expect(volta.itens.some((i) => i.nome === 'Ocultar E.')).toBe(true);
    expect(await verificarLink(s.slugAtual, tPendente, ipNovo(), AGORA)).toMatchObject({ ok: true });
    expect(await enviar(s, tPendente)).toEqual({ resultado: 'enviada' });
    expect((await c.query('SELECT count(*) AS n FROM mensagem WHERE salao_id = $1', [s.salaoId])).rows[0].n).toBe(mensagensAntes);
  });

  it('avaliação retirada (retirada_em) não é visível', async () => {
    const s = await salaoNovo();
    const a = await avaliar(s, 1);
    await avaliar(s, 5);
    await c.query('UPDATE avaliacao SET retirada_em = now() WHERE reserva_id = $1', [a.reservaId]);
    const r = await lerAvaliacoesPublicas(ctxPublico(s));
    expect([r.total, r.media]).toEqual([1, 5]);
  });
});

describe('CA-8: anonimização', () => {
  it('a avaliação some, nome e comentário ficam nulos, o link é invalidado, e os outros seguem', async () => {
    const s = await salaoNovo();
    const a = await avaliar(s, 1, 'Sai Daqui', 'Comentário pessoal');
    await avaliar(s, 5);
    const pendente = await criarAvaliavel(c, s, { nome: 'Sai Daqui' });
    // outra reserva da MESMA cliente, com convite ainda não usado
    const base = await c.query<{ inicio: Date; fim: Date }>('SELECT inicio, fim FROM reserva WHERE id = $1', [a.reservaId]);
    const quarentaDias = 40 * DIA_MS;
    const outraReserva = await inserirReserva(c, {
      salaoId: s.salaoId,
      profissionalId: s.gestor.profissionalId!,
      clienteId: a.clienteId,
      inicio: new Date(base.rows[0].inicio.getTime() + quarentaDias),
      fim: new Date(base.rows[0].fim.getTime() + quarentaDias),
      status: 'concluido',
      servicoId: s.servicos.ativos[0],
    });
    const { token: tOutra } = await emitirLink(s, outraReserva);

    const r = await anonimizarCliente(ctxDoGestor(s), { clienteId: a.clienteId }, AGORA);
    expect(r.resultado).toBe('anonimizada');

    const pub = await lerAvaliacoesPublicas(ctxPublico(s));
    expect([pub.total, pub.media]).toEqual([1, 5]);
    const { rows } = await c.query('SELECT nome_exibicao, comentario, nota FROM avaliacao WHERE reserva_id = $1', [a.reservaId]);
    expect(rows).toEqual([{ nome_exibicao: null, comentario: null, nota: 1 }]);
    expect(await verificarLink(s.slugAtual, tOutra, ipNovo(), AGORA)).toEqual({ ok: false, motivo: 'invalido' });
    expect(await enviar(s, tOutra)).toEqual({ resultado: 'link_invalido' });
    const cv = await conviteDe(c, outraReserva);
    expect(new Date(cv?.invalidado_em as string)).toEqual(AGORA);
    expect(pendente.clienteId).not.toBe(a.clienteId);
  });

  it('falha do gancho desfaz a anonimização por inteiro (transação)', async () => {
    const s = await salaoNovo();
    const a = await avaliar(s, 3, 'Fica Aqui', 'Continua');
    const falho = anonimizarCliente(ctxDoGestor(s), { clienteId: a.clienteId }, AGORA, {
      aoAnonimizar: async (ctx, d, repos) => {
        await repos.avaliacoes.anonimizarDaCliente(ctx, d.clienteId, d.agora);
        throw new Error('falha injetada');
      },
    });
    await expect(falho).rejects.toThrow('falha injetada');
    const { rows } = await c.query('SELECT nome_exibicao, comentario FROM avaliacao WHERE reserva_id = $1', [a.reservaId]);
    expect(rows).toEqual([{ nome_exibicao: 'Fica A.', comentario: 'Continua' }]);
    expect((await c.query('SELECT anonimizada_em FROM cliente WHERE id = $1', [a.clienteId])).rows[0].anonimizada_em).toBeNull();
    expect((await conviteDe(c, a.reservaId))?.invalidado_em).toBeNull();
    expect((await lerAvaliacoesPublicas(ctxPublico(s))).total).toBe(1);
  });
});
