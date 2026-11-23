import { randomUUID } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { criarReserva } from '@/server/reservas/criar-reserva';
import { criarReservaDaEquipe } from '@/server/reservas/reserva-equipe';
import { obterPrisma } from '@/server/repos/db';

import { conferirDerivados, contarLinhas, criarCenarioReserva, entradaReserva, sp, DIA } from '../../../support/reservas';
import { telefoneNovo } from '../../../support/sql';

import { AGORA, comTresProfissionais, enfileirar, entradaEquipe, linha, umaLinha } from './apoio';

// D-029 CA-14: encaixes sobrepostos em paralelo para a mesma profissional. A trava do profissional
// serializa e a exclusion constraint decide; nenhum 5xx nem impasse (40P01).

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterAll(() => {
  vi.restoreAllMocks();
});

describe('CA-14: 10 encaixes paralelos na mesma profissional', () => {
  it('fora da jornada, com confirmação: exatamente 1 criada e 9 horario_indisponivel, sem cliente nem mensagem órfãs', async () => {
    const c = await criarCenarioReserva({ jornada: [['09:00', '18:00']] });
    const antes = await contarLinhas(c.s.salaoId);
    const rs = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        criarReservaDaEquipe(
          c.ctxEquipe,
          entradaEquipe(c, { ...umaLinha(c, i % 2 === 0 ? '19:00' : '19:15'), confirmarEncaixe: true, chaveRequisicao: randomUUID() }),
          AGORA,
          { enfileirar },
        ),
      ),
    );
    expect(rs.filter((r) => r.resultado === 'criada')).toHaveLength(1);
    const outras = rs.filter((r) => r.resultado !== 'criada');
    expect(outras).toHaveLength(9);
    for (const r of outras) expect(r).toMatchObject({ resultado: 'horario_indisponivel' });
    const depois = await contarLinhas(c.s.salaoId);
    expect(depois).toEqual({
      reserva: antes.reserva + 1,
      itens: antes.itens + 1,
      cliente: antes.cliente + 1,
      consentimento: antes.consentimento + 1,
      mensagem: antes.mensagem + 1,
    });
    const itens = await obterPrisma().reservaItem.findMany({ where: { salaoId: c.s.salaoId } });
    expect(itens.filter((i) => i.encaixe)).toHaveLength(1);
    await conferirDerivados({ salaoId: c.s.salaoId });
  });

  it('encaixe da equipe × reserva pública no mesmo horário: só uma vence', async () => {
    const c = await criarCenarioReserva();
    const equipe = criarReservaDaEquipe(c.ctxEquipe, entradaEquipe(c, umaLinha(c, '10:00')), AGORA, { enfileirar });
    const publica = criarReserva(
      c.ctxSistema,
      entradaReserva(c, { itens: [{ servicoId: c.A, profissionalId: c.ana, inicio: sp(DIA, '10:00') }], cliente: { nome: 'Pública', telefone: telefoneNovo() }, chaveRequisicao: randomUUID() }),
      { enfileirar },
    );
    const rs = await Promise.all([equipe, publica]);
    expect(rs.filter((r) => r.resultado === 'criada')).toHaveLength(1);
    expect(rs.filter((r) => r.resultado === 'horario_indisponivel')).toHaveLength(1);
  });

  it('o mesmo envio 10 vezes (mesma chave): 1 reserva; as demais criada/repetida, sem erro', async () => {
    const c = await criarCenarioReserva();
    const chaveRequisicao = randomUUID();
    const telefone = telefoneNovo();
    const rs = await Promise.all(
      Array.from({ length: 10 }, () =>
        criarReservaDaEquipe(c.ctxEquipe, entradaEquipe(c, { chaveRequisicao, telefone }), AGORA, { enfileirar }),
      ),
    );
    expect(rs.filter((r) => r.resultado === 'criada')).toHaveLength(1);
    for (const r of rs) expect(['criada', 'repetida']).toContain(r.resultado);
    expect(await obterPrisma().reserva.count({ where: { salaoId: c.s.salaoId } })).toBe(1);
  });
});

describe('D-050 CA-23 × concorrência: 10 reservas de 3 itens em 3 profissionais, disputando um item', () => {
  it('as 10 querem a Carla às 15:00 (os outros itens em horários distintos): exatamente 1 criada, nada órfão', async () => {
    const c = await criarCenarioReserva();
    const { C, carla } = await comTresProfissionais(c);
    const antes = await contarLinhas(c.s.salaoId);
    const rs = await Promise.all(
      Array.from({ length: 10 }, (_, i) => {
        // Ana (B, 45 min) às 09:00 + 30i e Bia (A, 30 min) logo depois: sem cruzar dentro da reserva e
        // terminando antes das 14:45. Entre reservas a Ana também colide (outra causa de 23P01); a Carla às
        // 15:00 é disputada por todas, então no máximo uma vence (e a primeira a confirmar sempre vence).
        const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
        const base = 9 * 60 + i * 30;
        return criarReservaDaEquipe(
          c.ctxEquipe,
          entradaEquipe(c, {
            itens: [linha(c.B, c.ana, hhmm(base)), linha(c.A, c.bia, hhmm(base + 45)), linha(C, carla, '15:00')],
            chaveRequisicao: randomUUID(),
          }),
          AGORA,
          { enfileirar },
        );
      }),
    );
    const criadas = rs.filter((r) => r.resultado === 'criada');
    expect(criadas).toHaveLength(1);
    for (const r of rs.filter((x) => x.resultado !== 'criada')) expect(r).toMatchObject({ resultado: 'horario_indisponivel' });
    expect(await contarLinhas(c.s.salaoId)).toEqual({
      reserva: antes.reserva + 1,
      itens: antes.itens + 3,
      cliente: antes.cliente + 1,
      consentimento: antes.consentimento + 1,
      mensagem: antes.mensagem + 1,
    });
    await conferirDerivados({ salaoId: c.s.salaoId });
  });
});
