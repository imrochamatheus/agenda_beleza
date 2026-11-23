import { randomUUID } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { criarAntesDaReserva } from '@/server/protecao/futuras';
import { MENSAGENS_PROTECAO } from '@/server/protecao/tipos';
import { criarReserva } from '@/server/reservas/criar-reserva';
import { obterPrisma } from '@/server/repos/db';

import { AGORA, DIA, DIA_SEGUINTE, contarLinhas, criarCenarioReserva, definirJornada, entradaReserva, sp } from '../../support/reservas';
import type { CenarioReserva, DataCivil } from '../../support/reservas';
import { telefoneNovo } from '../../support/sql';

// D-050 T-5: CA-15 (RN-18). O limite de 3 futuras por número conta RESERVAS, não itens: uma reserva é
// futura se tem ao menos um item `confirmado` com início > agora. O gancho é o mesmo que o fluxo público
// injeta em `criarReserva` (`criarAntesDaReserva`, dentro da transação, depois do upsert da cliente).

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterAll(() => {
  vi.restoreAllMocks();
});

const db = () => obterPrisma();
const enfileirar = async () => ({ criado: true as const, id: 'job' });

type Cenario = CenarioReserva & { C: string; carla: string };

/** Ana (A, B), Bia (A) e Carla (C), todas com jornada 08:00–20:00. */
async function cenario(): Promise<Cenario> {
  const c = await criarCenarioReserva({ jornada: [['08:00', '20:00']] });
  await definirJornada(c.s.salaoId, c.bia, [['08:00', '20:00']]);
  const carla = (await db().profissional.create({ data: { salaoId: c.s.salaoId, nome: 'Carla' }, select: { id: true } })).id;
  await definirJornada(c.s.salaoId, carla, [['08:00', '20:00']]);
  const C = (await db().servico.create({ data: { salaoId: c.s.salaoId, nome: 'C', precoCentavos: 3000, duracaoMin: 30 }, select: { id: true } })).id;
  await db().servicoProfissional.create({ data: { salaoId: c.s.salaoId, servicoId: C, profissionalId: carla } });
  return { ...c, C, carla };
}

/** Reserva de 3 itens (A com a Bia, B com a Ana, C com a Carla) a partir da hora `h` do dia `dia`. */
function tresItens(c: Cenario, dia: DataCivil, h: number) {
  const hh = (x: number) => sp(dia, `${String(x).padStart(2, '0')}:00`);
  return [
    { servicoId: c.A, profissionalId: c.bia, inicio: hh(h) },
    { servicoId: c.B, profissionalId: c.ana, inicio: hh(h + 1) },
    { servicoId: c.C, profissionalId: c.carla, inicio: hh(h + 2) },
  ];
}

const reservar = (c: Cenario, telefone: string, itens: ReturnType<typeof tresItens>, chave: string | null = randomUUID()) =>
  criarReserva(c.ctxSistema, entradaReserva(c, { itens, chaveRequisicao: chave, cliente: { nome: 'Ana', telefone } }), {
    enfileirar,
    antesDaReserva: criarAntesDaReserva({ chave, agora: AGORA }),
  });

describe('CA-15: limite de futuras conta reservas', () => {
  it('2 reservas futuras de 3 itens (6 itens): a 3ª com 3 itens é aceita; a 4ª é recusada sem gravar nada', async () => {
    const c = await cenario();
    const telefone = telefoneNovo();
    expect((await reservar(c, telefone, tresItens(c, DIA, 8))).resultado).toBe('criada');
    expect((await reservar(c, telefone, tresItens(c, DIA, 12))).resultado).toBe('criada');
    expect((await reservar(c, telefone, tresItens(c, DIA, 16))).resultado).toBe('criada');
    expect(await contarLinhas(c.s.salaoId)).toMatchObject({ reserva: 3, itens: 9 });
    const antes = await contarLinhas(c.s.salaoId);
    expect(await reservar(c, telefone, tresItens(c, DIA_SEGUINTE, 8))).toEqual({ resultado: 'recusado', motivo: MENSAGENS_PROTECAO.futuras });
    expect(await contarLinhas(c.s.salaoId)).toEqual(antes);
  });

  it('uma reserva cujos itens futuros foram todos cancelados não conta; um item futuro confirmado basta para contar', async () => {
    const c = await cenario();
    const telefone = telefoneNovo();
    const ids: string[] = [];
    for (const h of [8, 12, 16]) {
      const r = await reservar(c, telefone, tresItens(c, DIA, h));
      if (r.resultado !== 'criada') throw new Error('esperava criada');
      ids.push(r.reserva.id);
    }
    // Na 1ª: cancela dois itens; resta um confirmado futuro → ainda conta.
    const itens = await db().reservaItem.findMany({ where: { reservaId: ids[0] }, orderBy: { inicio: 'asc' } });
    await db().reservaItem.updateMany({ where: { id: { in: [itens[0].id, itens[1].id] } }, data: { status: 'cancelado' } });
    expect(await reservar(c, telefone, tresItens(c, DIA_SEGUINTE, 8))).toEqual({ resultado: 'recusado', motivo: MENSAGENS_PROTECAO.futuras });
    // Cancela o último item (e o derivado): a 1ª deixa de contar.
    await db().reservaItem.update({ where: { id: itens[2].id }, data: { status: 'cancelado' } });
    await db().reserva.update({ where: { id: ids[0] }, data: { status: 'cancelado', canceladaEm: AGORA } });
    expect((await reservar(c, telefone, tresItens(c, DIA_SEGUINTE, 8))).resultado).toBe('criada');
  });

  it('a requisição repetida (mesma chave) de uma reserva de 3 itens nunca é recusada pelo limite', async () => {
    const c = await cenario();
    const telefone = telefoneNovo();
    const chave = randomUUID();
    const primeira = await reservar(c, telefone, tresItens(c, DIA, 8), chave);
    expect(primeira.resultado).toBe('criada');
    await reservar(c, telefone, tresItens(c, DIA, 12));
    await reservar(c, telefone, tresItens(c, DIA, 16));
    const repetida = await reservar(c, telefone, tresItens(c, DIA, 8), chave);
    expect(repetida.resultado).toBe('repetida');
  });

  it('10 tentativas em paralelo do mesmo número, cada uma com 2 itens em horários distintos: exatamente 3 reservas', async () => {
    const c = await cenario();
    const telefone = telefoneNovo();
    const rs = await Promise.all(
      Array.from({ length: 10 }, (_, k) => {
        const dia: DataCivil = { ...DIA, dia: DIA.dia + k };
        return reservar(c, telefone, tresItens(c, dia, 9).slice(0, 2));
      }),
    );
    expect(rs.filter((r) => r.resultado === 'criada')).toHaveLength(3);
    for (const r of rs.filter((x) => x.resultado !== 'criada')) {
      expect(r).toEqual({ resultado: 'recusado', motivo: MENSAGENS_PROTECAO.futuras });
    }
    expect(await contarLinhas(c.s.salaoId)).toMatchObject({ reserva: 3, itens: 6, mensagem: 3 });
  });
});
