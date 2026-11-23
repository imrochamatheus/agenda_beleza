import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MENSAGENS_PROTECAO } from '@/server/protecao/tipos';
import { reservarPelaPagina } from '@/server/reserva-publica/servico';
import type { EntradaReservaPublica } from '@/server/reserva-publica/tipos';
import { obterPrisma } from '@/server/repos/db';

import { contarLinhas, criarBarreira, definirJornada } from '../../support/reservas';
import { AGORA, DIA, criarCenarioReserva as criarBase, enfileirar, entradaPublica, sp } from '../../support/reserva-publica';
import type { CenarioReserva } from '../../support/reserva-publica';
import { telefoneNovo } from '../../support/sql';

// D-027 CA-7: tentativas paralelas do mesmo número, com profissionais iguais e diferentes, nunca passam
// de 3 futuras. A trava é a da linha da cliente (upsert) + READ COMMITTED; sem impasse (sem 40P01/5xx).
// O limite do número sobe para não mascarar a regra das futuras.

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.stubEnv('PROTECAO_LIMITE_NUMERO', '1000');
  vi.stubEnv('PROTECAO_LIMITE_IP_RESERVA', '1000');
});
afterEach(() => {
  vi.unstubAllEnvs();
});
afterAll(() => {
  vi.restoreAllMocks();
});

const hora = (h: number) => sp(DIA, `${String(h).padStart(2, '0')}:00`).toISOString();
const reservar = (e: EntradaReservaPublica, deps: Parameters<typeof reservarPelaPagina>[2] = {}) =>
  reservarPelaPagina(e, AGORA, { enfileirar, ...deps });

/** Ana e Bia com jornada (o cenário base só dá jornada à Ana). */
async function criarCenarioReserva() {
  const c = await criarBase();
  await definirJornada(c.s.salaoId, c.bia, [['09:00', '19:00']]);
  return c;
}

async function preparar(c: CenarioReserva, telefone: string, existentes: number) {
  for (let i = 0; i < existentes; i++) {
    expect((await reservar(entradaPublica(c, { telefone, inicio: hora(9 + i) }))).resultado).toBe('confirmada');
  }
}

function conferir(rs: Awaited<ReturnType<typeof reservar>>[], criadas: number) {
  expect(rs.filter((r) => r.resultado === 'confirmada')).toHaveLength(criadas);
  const outras = rs.filter((r) => r.resultado !== 'confirmada');
  for (const r of outras) expect(r).toEqual({ resultado: 'recusado', mensagem: MENSAGENS_PROTECAO.futuras });
}

describe('CA-7: futuras em paralelo', () => {
  it('2 futuras + 2 tentativas simultâneas de profissionais diferentes (barreira dentro das transações): exatamente 1 entra', async () => {
    const c = await criarCenarioReserva();
    const telefone = telefoneNovo();
    await preparar(c, telefone, 2);
    const barreira = criarBarreira(2);
    const rs = await Promise.all(
      [c.ana, c.bia].map((p) =>
        reservar(entradaPublica(c, { telefone, profissionalId: p, inicio: hora(14) }), { aposRevalidar: barreira }),
      ),
    );
    conferir(rs, 1);
    expect(await obterPrisma().reserva.count({ where: { salaoId: c.s.salaoId, status: 'confirmado' } })).toBe(3);
  });

  it.each([5, 10])('2 futuras + %i tentativas no mesmo horário/profissional ou em outros: no máximo 3 no total', async (n) => {
    const c = await criarCenarioReserva();
    const telefone = telefoneNovo();
    await preparar(c, telefone, 2);
    const rs = await Promise.all(
      Array.from({ length: n }, (_, i) =>
        reservar(entradaPublica(c, { telefone, profissionalId: i % 2 === 0 ? c.ana : c.bia, inicio: hora(13 + (i % 3)) })),
      ),
    );
    // Cada tentativa é "criada", "recusada por futuras" ou "horário indisponível" (mesmo profissional e horário): nunca 5xx.
    for (const r of rs) {
      expect(['confirmada', 'recusado', 'reescolher']).toContain(r.resultado);
      if (r.resultado === 'recusado') expect(r.mensagem).toBe(MENSAGENS_PROTECAO.futuras);
    }
    expect(rs.filter((r) => r.resultado === 'confirmada').length).toBeLessThanOrEqual(1);
    expect(await obterPrisma().reserva.count({ where: { salaoId: c.s.salaoId, status: 'confirmado' } })).toBeLessThanOrEqual(3);
    // Se ninguém criou, só foi por conflito de horário (todas 'reescolher'); com 1 ou mais criadas, o total é 3.
    const n3 = await obterPrisma().reserva.count({ where: { salaoId: c.s.salaoId, status: 'confirmado' } });
    expect(n3).toBe(2 + rs.filter((r) => r.resultado === 'confirmada').length);
  });

  it.each([5, 10])('0 futuras + %i tentativas em horários distintos: exatamente 3 entram', async (n) => {
    const c = await criarCenarioReserva();
    const telefone = telefoneNovo();
    const rs = await Promise.all(
      Array.from({ length: n }, (_, i) => reservar(entradaPublica(c, { telefone, profissionalId: i % 2 === 0 ? c.ana : c.bia, inicio: hora(9 + i) }))),
    );
    conferir(rs, 3);
    expect(await obterPrisma().reserva.count({ where: { salaoId: c.s.salaoId, status: 'confirmado' } })).toBe(3);
    const l = await contarLinhas(c.s.salaoId);
    expect([l.reserva, l.itens, l.mensagem]).toEqual([3, 3, 3]);
  });

  it('cliente nova: tentativas simultâneas do mesmo número resultam numa única cliente e no máximo 3 reservas', async () => {
    const c = await criarCenarioReserva();
    const telefone = telefoneNovo();
    const antes = (await contarLinhas(c.s.salaoId)).cliente;
    const rs = await Promise.all(
      Array.from({ length: 6 }, (_, i) => reservar(entradaPublica(c, { telefone, inicio: hora(9 + i), profissionalId: c.ana }))),
    );
    conferir(rs, 3);
    expect((await contarLinhas(c.s.salaoId)).cliente - antes).toBe(1);
  });

  it('números diferentes não se bloqueiam', async () => {
    const c = await criarCenarioReserva();
    const rs = await Promise.all(
      Array.from({ length: 4 }, (_, i) => reservar(entradaPublica(c, { telefone: telefoneNovo(), inicio: hora(9 + i) }))),
    );
    conferir(rs, 4);
  });
});
