import { randomUUID } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { criarReserva } from '@/server/reservas/criar-reserva';
import { criarReservaDaEquipe } from '@/server/reservas/reserva-equipe';
import { obterPrisma } from '@/server/repos/db';

import { contarLinhas, criarCenarioReserva, entradaReserva, sp, DIA } from '../../../support/reservas';
import { telefoneNovo } from '../../../support/sql';

import { AGORA, enfileirar, entradaEquipe } from './apoio';

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
          entradaEquipe(c, { hora: i % 2 === 0 ? '19:00' : '19:15', confirmarEncaixe: true, chaveRequisicao: randomUUID() }),
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
    const linhas = await obterPrisma().reserva.findMany({ where: { salaoId: c.s.salaoId } });
    expect(linhas.filter((l) => l.encaixe && l.origem === 'equipe')).toHaveLength(1);
  });

  it('encaixe da equipe × reserva pública no mesmo horário: só uma vence', async () => {
    const c = await criarCenarioReserva();
    const equipe = criarReservaDaEquipe(c.ctxEquipe, entradaEquipe(c, { hora: '10:00' }), AGORA, { enfileirar });
    const publica = criarReserva(
      c.ctxSistema,
      entradaReserva(c, { inicio: sp(DIA, '10:00'), cliente: { nome: 'Pública', telefone: telefoneNovo() }, chaveRequisicao: randomUUID() }),
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
