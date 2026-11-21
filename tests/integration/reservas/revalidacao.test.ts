import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { consultarDisponibilidade } from '@/server/disponibilidade/servico';
import { criarReserva } from '@/server/reservas/criar-reserva';
import { obterPrisma } from '@/server/repos/db';

import { AGORA, DIA, DIA_SEGUINTE, contarLinhas, criarCenarioReserva, entradaReserva, inserirReservaDireta, sp } from '../../support/reservas';
import type { CenarioReserva } from '../../support/reservas';

// D-025 T-6a: CA-3, CA-7, CA-8, CA-9, CA-10 (revalidação no servidor, sem segunda regra).

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterAll(() => {
  vi.restoreAllMocks();
});

const db = () => obterPrisma();
const enfileirar = async () => ({ criado: true as const, id: 'job' });
const tentar = (c: CenarioReserva, inicio: Date, sobre: Parameters<typeof entradaReserva>[1] = {}, publico = true) =>
  criarReserva(publico ? c.ctxSistema : c.ctxEquipe, entradaReserva(c, { inicio, ...sobre }), { enfileirar });
const REVAL = { resultado: 'horario_indisponivel', causa: 'revalidacao' } as const;

async function semEfeito(c: CenarioReserva, fn: () => Promise<unknown>): Promise<void> {
  const antes = await contarLinhas(c.s.salaoId);
  await fn();
  expect(await contarLinhas(c.s.salaoId)).toEqual(antes);
}

describe('CA-3: um caso por causa, sem gravar nada', () => {
  it('ocupado por outra reserva', async () => {
    const c = await criarCenarioReserva();
    await inserirReservaDireta(c, { inicio: sp(DIA, '10:00'), fim: sp(DIA, '10:30') });
    await semEfeito(c, async () => expect(await tentar(c, sp(DIA, '10:00'))).toEqual(REVAL));
  });

  it('bloqueio criado depois da consulta', async () => {
    const c = await criarCenarioReserva();
    await db().bloqueio.create({ data: { salaoId: c.s.salaoId, profissionalId: c.ana, inicio: sp(DIA, '09:30'), fim: sp(DIA, '10:30') } });
    await semEfeito(c, async () => expect(await tentar(c, sp(DIA, '10:00'))).toEqual(REVAL));
  });

  it('serviço desativado', async () => {
    const c = await criarCenarioReserva();
    await db().servico.update({ where: { id: c.A }, data: { ativo: false } });
    await semEfeito(c, async () => expect(await tentar(c, sp(DIA, '10:00'))).toEqual({ resultado: 'servico_indisponivel' }));
  });

  it('profissional desativado', async () => {
    const c = await criarCenarioReserva();
    await db().profissional.update({ where: { id: c.ana }, data: { ativo: false } });
    await semEfeito(c, async () => expect(await tentar(c, sp(DIA, '10:00'))).toEqual({ resultado: 'profissional_indisponivel' }));
  });

  it('antecedência vencida (agora 09:30 local, mínimo de 2 h)', async () => {
    const c = await criarCenarioReserva();
    const entrada = entradaReserva(c, { inicio: sp(DIA, '10:00'), agora: sp(DIA, '09:30') });
    await semEfeito(c, async () => expect(await criarReserva(c.ctxSistema, entrada, { enfileirar })).toEqual(REVAL));
  });
});

describe('CA-7: funcionamento do salão × jornada', () => {
  const funcionamento = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, [['10:00', '18:00']]])) as Record<number, [string, string][]>;

  it('60 min às 09:00 e 17:30 recusados, sem gravar nem cliente; 10:00 e 17:00 aceitos', async () => {
    const c = await criarCenarioReserva({ funcionamento, servicoA: { precoCentavos: 5000, duracaoMin: 60 } });
    await semEfeito(c, async () => {
      expect(await tentar(c, sp(DIA, '09:00'))).toEqual(REVAL);
      expect(await tentar(c, sp(DIA, '17:30'))).toEqual(REVAL);
    });
    expect((await tentar(c, sp(DIA, '10:00'))).resultado).toBe('criada');
    expect((await tentar(c, sp(DIA, '17:00'))).resultado).toBe('criada');
  });

  it('dia fechado é recusado', async () => {
    const c = await criarCenarioReserva({ funcionamento: { 1: [['10:00', '18:00']] } });
    await semEfeito(c, async () => expect(await tentar(c, sp(DIA, '10:00'))).toEqual(REVAL));
  });

  it('funcionamento não definido: só a jornada decide', async () => {
    const c = await criarCenarioReserva();
    expect((await tentar(c, sp(DIA, '09:00'))).resultado).toBe('criada');
  });
});

describe('CA-8: cada causa de recusa e a paridade com a consulta', () => {
  it('fora da grade, janela, bloqueio do profissional, bloqueio do salão e almoço', async () => {
    const c = await criarCenarioReserva({ jornada: [['09:00', '12:00'], ['13:00', '19:00']] });
    await db().bloqueio.create({ data: { salaoId: c.s.salaoId, profissionalId: c.ana, inicio: sp(DIA, '15:00'), fim: sp(DIA, '16:00') } });
    await db().bloqueio.create({ data: { salaoId: c.s.salaoId, profissionalId: null, inicio: sp(DIA, '17:00'), fim: sp(DIA, '18:00') } });
    await semEfeito(c, async () => {
      expect(await tentar(c, sp(DIA, '10:07'))).toEqual(REVAL);
      expect(await tentar(c, sp({ ano: 2027, mes: 3, dia: 2 }, '10:00'))).toEqual(REVAL);
      expect(await tentar(c, sp(DIA, '15:00'))).toEqual(REVAL);
      expect(await tentar(c, sp(DIA, '17:15'))).toEqual(REVAL);
      expect(await tentar(c, sp(DIA, '12:00'))).toEqual(REVAL);
    });
  });

  it.each(['confirmado', 'concluido', 'nao_compareceu'] as const)('sobreposto a reserva %s é recusado', async (status) => {
    const c = await criarCenarioReserva();
    await inserirReservaDireta(c, { inicio: sp(DIA, '10:00'), fim: sp(DIA, '10:30'), status });
    expect(await tentar(c, sp(DIA, '10:00'))).toEqual(REVAL);
  });

  it('sobreposto só a reserva cancelada é aceito', async () => {
    const c = await criarCenarioReserva();
    await inserirReservaDireta(c, { inicio: sp(DIA, '10:00'), fim: sp(DIA, '10:30'), status: 'cancelado' });
    expect((await tentar(c, sp(DIA, '10:00'))).resultado).toBe('criada');
  });

  it('paridade: aceita exatamente o que consultarDisponibilidade oferece', async () => {
    const c = await criarCenarioReserva({ jornada: [['09:00', '12:00'], ['14:00', '19:00']] });
    await db().bloqueio.create({ data: { salaoId: c.s.salaoId, profissionalId: c.ana, inicio: sp(DIA, '16:00'), fim: sp(DIA, '16:40') } });
    await inserirReservaDireta(c, { inicio: sp(DIA, '10:30'), fim: sp(DIA, '11:00') });
    const consulta = await consultarDisponibilidade(c.ctxSistema, { servicoIds: [c.A], profissionalId: c.ana, de: DIA, ate: DIA, agora: AGORA });
    if (consulta.resultado !== 'ok') throw new Error('consulta inesperada');
    const oferecidos = new Set(consulta.profissionais[0].dias[0].horarios.map((h) => h.inicio.getTime()));
    expect(oferecidos.size).toBeGreaterThan(10);
    let aceitos = 0;
    for (let m = 7 * 60; m <= 21 * 60; m += 15) {
      const inicio = new Date(sp(DIA, '00:00').getTime() + m * 60_000);
      const r = await tentar(c, inicio);
      if (oferecidos.has(inicio.getTime())) {
        expect(r.resultado, `esperava aceitar ${inicio.toISOString()}`).toBe('criada');
        aceitos += 1;
        await db().reserva.updateMany({ where: { salaoId: c.s.salaoId, inicio }, data: { status: 'cancelado' } });
      } else {
        expect(r, `esperava recusar ${inicio.toISOString()}`).toEqual(REVAL);
      }
    }
    expect(aceitos).toBe(oferecidos.size);
  });

  it('o dia seguinte também é revalidado pelo dia local', async () => {
    const c = await criarCenarioReserva();
    expect((await tentar(c, sp(DIA_SEGUINTE, '09:00'))).resultado).toBe('criada');
  });
});

describe('CA-9: intervalo entre atendimentos', () => {
  it('reserva 10:00–11:00 com intervalo 15: 11:00 recusado, 11:15 aceito com ocupado_ate = fim + 15', async () => {
    const c = await criarCenarioReserva({ intervaloMin: 15 });
    await inserirReservaDireta(c, { inicio: sp(DIA, '10:00'), fim: sp(DIA, '11:00'), ocupadoAte: sp(DIA, '11:15') });
    expect(await tentar(c, sp(DIA, '11:00'))).toEqual(REVAL);
    const r = await tentar(c, sp(DIA, '11:15'));
    expect(r.resultado).toBe('criada');
    if (r.resultado !== 'criada') return;
    expect(r.reserva.fim).toEqual(sp(DIA, '11:45'));
    expect(r.reserva.ocupadoAte).toEqual(sp(DIA, '12:00'));
  });
});

describe('CA-10: profissional e serviços indisponíveis', () => {
  it('profissional sem vínculo com um dos serviços', async () => {
    const c = await criarCenarioReserva();
    await db().jornada.createMany({ data: [0, 1, 2, 3, 4, 5, 6].map((diaSemana) => ({ salaoId: c.s.salaoId, profissionalId: c.bia, diaSemana, inicioMin: 540, fimMin: 1140 })) });
    await semEfeito(c, async () =>
      expect(await tentar(c, sp(DIA, '10:00'), { profissionalId: c.bia, servicoIds: [c.A, c.B] })).toEqual({ resultado: 'profissional_indisponivel' }),
    );
  });

  it('serviço inativo da fábrica e profissional inativo da fábrica', async () => {
    const c = await criarCenarioReserva();
    await semEfeito(c, async () => {
      expect(await tentar(c, sp(DIA, '10:00'), { servicoIds: [c.s.servicos.inativoId] })).toEqual({ resultado: 'servico_indisponivel' });
      expect(await tentar(c, sp(DIA, '10:00'), { profissionalId: c.s.profissionalInativoId })).toEqual({ resultado: 'profissional_indisponivel' });
    });
  });
});
