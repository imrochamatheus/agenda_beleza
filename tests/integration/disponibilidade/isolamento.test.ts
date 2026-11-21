import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { consultarDisponibilidade } from '@/server/disponibilidade/servico';
import { resolverSalaoPorSlug } from '@/server/repos/publico';
import { criarAdminContext } from '@/server/tenant/context';
import type { ContextoDeLeituraDeAgenda } from '@/server/tenant/context';
import { NaoEncontrado } from '@/server/tenant/erros';

import { conectar } from '../../support/sql';

import {
  AGORA, DIA, TODOS_OS_DIAS, criarCenario, ctxDoGestor, ctxPublico, definirFuncionamento, inserirBloqueio,
  inserirCliente, inserirJornada, inserirReserva, rotulos, sp,
} from './apoio';
import type { Cenario } from './apoio';

// D-018 T-4 (CA-20, CA-40): isolamento entre salões na leitura de agenda.

let c: pg.Client;
beforeAll(async () => {
  c = await conectar();
});
afterAll(async () => {
  await c.end();
});

const consultar = (x: Cenario, ids: string[] = [x.A], extra: { profissionalId?: string } = {}) =>
  consultarDisponibilidade(ctxPublico(x.s), { servicoIds: ids, de: DIA, ate: DIA, agora: AGORA, ...extra });

async function par(): Promise<{ s1: Cenario; s2: Cenario }> {
  const s1 = await criarCenario(c);
  const s2 = await criarCenario(c);
  for (const x of [s1, s2]) {
    await inserirJornada(c, x.s.salaoId, x.ana, TODOS_OS_DIAS, ['09:00', '12:00']);
    await inserirJornada(c, x.s.salaoId, x.bia, TODOS_OS_DIAS, ['09:00', '12:00']);
  }
  return { s1, s2 };
}

describe('CA-20: dados de S2 nunca entram no cálculo de S1', () => {
  it('reserva e bloqueio de dia inteiro em S2 não mudam o resultado de S1', async () => {
    const { s1, s2 } = await par();
    const antes = await consultar(s1);
    expect(rotulos(antes, 0).length).toBeGreaterThan(0);
    const cli = await inserirCliente(c, s2.s.salaoId);
    await inserirReserva(c, { salaoId: s2.s.salaoId, profissionalId: s2.ana, clienteId: cli, inicio: sp(DIA, '09:00'), fim: sp(DIA, '12:00') });
    await inserirBloqueio(c, s2.s.salaoId, null, sp(DIA, '00:00'), sp({ ano: 2026, mes: 12, dia: 2 }, '00:00'));
    expect(await consultar(s1)).toEqual(antes);
    // E o bloqueio e a reserva de fato valem em S2.
    expect(rotulos(await consultar(s2), 0)).toEqual([]);
    expect(rotulos(await consultar(s2), 1)).toEqual([]);
  });

  it('um resultado de S1 é igual ao de um salão equivalente sem os dados de S2', async () => {
    const { s1, s2 } = await par();
    const cli = await inserirCliente(c, s2.s.salaoId);
    await inserirReserva(c, { salaoId: s2.s.salaoId, profissionalId: s2.ana, clienteId: cli, inicio: sp(DIA, '09:00'), fim: sp(DIA, '12:00') });
    const isolado = await criarCenario(c);
    await inserirJornada(c, isolado.s.salaoId, isolado.ana, TODOS_OS_DIAS, ['09:00', '12:00']);
    await inserirJornada(c, isolado.s.salaoId, isolado.bia, TODOS_OS_DIAS, ['09:00', '12:00']);
    const a = await consultar(s1);
    const b = await consultar(isolado);
    if (a.resultado !== 'ok' || b.resultado !== 'ok') throw new Error();
    expect(a.profissionais.map((p) => p.dias)).toEqual(b.profissionais.map((p) => p.dias));
  });

  it('serviço de S2 → servico_indisponivel; profissional de S2 → NaoEncontrado', async () => {
    const { s1, s2 } = await par();
    expect(await consultar(s1, [s2.A])).toEqual({ resultado: 'servico_indisponivel' });
    expect(await consultar(s1, [s1.A, s2.B])).toEqual({ resultado: 'servico_indisponivel' });
    await expect(consultar(s1, [s1.A], { profissionalId: s2.ana })).rejects.toBeInstanceOf(NaoEncontrado);
  });

  it('a resposta para ids de S2 não distingue "existe em outro salão" de "não existe"', async () => {
    const { s1, s2 } = await par();
    const inexistente = '11111111-1111-4111-8111-111111111111';
    expect(await consultar(s1, [s2.A])).toEqual(await consultar(s1, [inexistente]));
    const erro = async (id: string) => consultar(s1, [s1.A], { profissionalId: id }).catch((e: unknown) => e);
    expect(await erro(s2.ana)).toBeInstanceOf(NaoEncontrado);
    expect((await erro(s2.ana) as Error).message).toBe((await erro(inexistente) as Error).message);
  });

  it('PublicoContext resolvido pelo slug dá o mesmo resultado que o TenantContext do gestor', async () => {
    const { s1 } = await par();
    const { contexto } = await resolverSalaoPorSlug(s1.s.slugAtual);
    const entrada = { servicoIds: [s1.A], de: DIA, ate: DIA, agora: AGORA };
    expect(await consultarDisponibilidade(contexto, entrada)).toEqual(await consultarDisponibilidade(ctxDoGestor(s1.s), entrada));
  });

  it('o AdminContext é recusado (erro de programação)', async () => {
    const { s1 } = await par();
    const admin = criarAdminContext(s1.s.gestor.usuarioId) as unknown as ContextoDeLeituraDeAgenda;
    await expect(consultarDisponibilidade(admin, { servicoIds: [s1.A], de: DIA, ate: DIA, agora: AGORA })).rejects.toThrow(/leitura de agenda exige/);
  });
});

describe('CA-40: o funcionamento de um salão não afeta o outro', () => {
  it('S1 sem funcionamento informado e S2 com todos os dias fechados: S1 não muda', async () => {
    const { s1, s2 } = await par();
    const antes = await consultar(s1);
    await definirFuncionamento(c, s2.s.salaoId, {});
    expect(await consultar(s1)).toEqual(antes);
    expect(rotulos(await consultar(s2), 0)).toEqual([]);
  });

  it('S1 com funcionamento curto e S2 sem: S2 não é limitado pelo de S1', async () => {
    const { s1, s2 } = await par();
    const semLimite = rotulos(await consultar(s2), 0);
    await definirFuncionamento(c, s1.s.salaoId, { 2: [['09:00', '10:00']] });
    expect(rotulos(await consultar(s1), 0)).toEqual(['09:00', '09:15', '09:30']);
    expect(rotulos(await consultar(s2), 0)).toEqual(semLimite);
    expect(semLimite.length).toBeGreaterThan(3);
  });
});
