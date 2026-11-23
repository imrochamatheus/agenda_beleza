import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { consultarDisponibilidadePorServico } from '@/server/disponibilidade/servico';
import { criarReserva } from '@/server/reservas/criar-reserva';
import { obterPrisma } from '@/server/repos/db';

import { AGORA, DIA, DIA_SEGUINTE, contarLinhas, criarCenarioReserva, entradaReserva, sp } from '../../support/reservas';
import type { CenarioReserva } from '../../support/reservas';

import { item, jornadaDaBia, ocupar, revalidacao, um } from './apoio-itens';

// D-025 T-6a: CA-3, CA-7, CA-8, CA-9, CA-10 (revalidação no servidor, sem segunda regra); D-050 T-5: por item.

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterAll(() => {
  vi.restoreAllMocks();
});

const db = () => obterPrisma();
const enfileirar = async () => ({ criado: true as const, id: 'job' });
/** Um item (serviço A e Ana, salvo `o`) no público. */
const tentar = (c: CenarioReserva, inicio: Date, o: { servicoId?: string; profissionalId?: string } = {}) =>
  criarReserva(c.ctxSistema, entradaReserva(c, um(c, inicio, o)), { enfileirar });
const REVAL = revalidacao();

async function semEfeito(c: CenarioReserva, fn: () => Promise<unknown>): Promise<void> {
  const antes = await contarLinhas(c.s.salaoId);
  await fn();
  expect(await contarLinhas(c.s.salaoId)).toEqual(antes);
}

describe('CA-3: um caso por causa, sem gravar nada', () => {
  it('ocupado por outra reserva', async () => {
    const c = await criarCenarioReserva();
    await ocupar(c, { inicio: sp(DIA, '10:00'), fim: sp(DIA, '10:30') });
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
    await semEfeito(c, async () => expect(await tentar(c, sp(DIA, '10:00'))).toEqual({ resultado: 'profissional_indisponivel', itens: [0] }));
  });

  it('antecedência vencida (agora 09:30 local, mínimo de 2 h)', async () => {
    const c = await criarCenarioReserva();
    const entrada = entradaReserva(c, { ...um(c, sp(DIA, '10:00')), agora: sp(DIA, '09:30') });
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
    await ocupar(c, { inicio: sp(DIA, '10:00'), fim: sp(DIA, '10:30'), status });
    expect(await tentar(c, sp(DIA, '10:00'))).toEqual(REVAL);
  });

  it('sobreposto só a reserva cancelada é aceito', async () => {
    const c = await criarCenarioReserva();
    await ocupar(c, { inicio: sp(DIA, '10:00'), fim: sp(DIA, '10:30'), status: 'cancelado' });
    expect((await tentar(c, sp(DIA, '10:00'))).resultado).toBe('criada');
  });

  it('paridade: aceita exatamente o que consultarDisponibilidadePorServico oferece', async () => {
    const c = await criarCenarioReserva({ jornada: [['09:00', '12:00'], ['14:00', '19:00']] });
    await db().bloqueio.create({ data: { salaoId: c.s.salaoId, profissionalId: c.ana, inicio: sp(DIA, '16:00'), fim: sp(DIA, '16:40') } });
    await ocupar(c, { inicio: sp(DIA, '10:30'), fim: sp(DIA, '11:00') });
    const consulta = await consultarDisponibilidadePorServico(c.ctxSistema, { servicoIds: [c.A], de: DIA, ate: DIA, agora: AGORA });
    if (consulta.resultado !== 'ok') throw new Error('consulta inesperada');
    const daAna = consulta.servicos[0].profissionais.find((p) => p.profissionalId === c.ana);
    const oferecidos = new Set(daAna!.dias[0].horarios.map((h) => h.inicio.getTime()));
    expect(oferecidos.size).toBeGreaterThan(10);
    let aceitos = 0;
    for (let m = 7 * 60; m <= 21 * 60; m += 15) {
      const inicio = new Date(sp(DIA, '00:00').getTime() + m * 60_000);
      const r = await tentar(c, inicio);
      if (oferecidos.has(inicio.getTime())) {
        expect(r.resultado, `esperava aceitar ${inicio.toISOString()}`).toBe('criada');
        aceitos += 1;
        if (r.resultado !== 'criada') throw new Error('esperava criada');
        // Cancela o item (e o derivado) para liberar o horário seguinte da grade.
        await db().reservaItem.updateMany({ where: { reservaId: r.reserva.id }, data: { status: 'cancelado' } });
        await db().reserva.update({ where: { id: r.reserva.id }, data: { status: 'cancelado', canceladaEm: new Date() } });
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
    await ocupar(c, { inicio: sp(DIA, '10:00'), fim: sp(DIA, '11:00'), ocupadoAte: sp(DIA, '11:15') });
    expect(await tentar(c, sp(DIA, '11:00'))).toEqual(REVAL);
    const r = await tentar(c, sp(DIA, '11:15'));
    expect(r.resultado).toBe('criada');
    if (r.resultado !== 'criada') return;
    expect(r.reserva.fim).toEqual(sp(DIA, '11:45'));
    expect(r.reserva.itens[0].ocupadoAte).toEqual(sp(DIA, '12:00'));
  });
});

describe('CA-10: profissional e serviços indisponíveis', () => {
  it('profissional sem vínculo com o serviço do item', async () => {
    const c = await criarCenarioReserva();
    await jornadaDaBia(c);
    await semEfeito(c, async () =>
      expect(await tentar(c, sp(DIA, '10:00'), { profissionalId: c.bia, servicoId: c.B })).toEqual({ resultado: 'profissional_indisponivel', itens: [0] }),
    );
  });

  it('serviço inativo da fábrica e profissional inativo da fábrica', async () => {
    const c = await criarCenarioReserva();
    await semEfeito(c, async () => {
      expect(await tentar(c, sp(DIA, '10:00'), { servicoId: c.s.servicos.inativoId })).toEqual({ resultado: 'servico_indisponivel' });
      expect(await tentar(c, sp(DIA, '10:00'), { profissionalId: c.s.profissionalInativoId })).toEqual({ resultado: 'profissional_indisponivel', itens: [0] });
    });
  });
});

describe('RN-9/RN-12: os outros itens da MESMA reserva ocupam o profissional com o intervalo', () => {
  it('B (Ana) às 10:30 com A (Ana) às 10:00 e intervalo 15 → entre_itens (antes da revalidação); às 10:45, aceito', async () => {
    const c = await criarCenarioReserva({ intervaloMin: 15 });
    const pedir = (hhmm: string) =>
      criarReserva(c.ctxSistema, entradaReserva(c, { itens: [item(c, sp(DIA, '10:00')), item(c, sp(DIA, hhmm), { servicoId: c.B })] }), { enfileirar });
    await semEfeito(c, async () =>
      expect(await pedir('10:30')).toEqual({ resultado: 'horario_indisponivel', causa: 'entre_itens', itens: [1], conflitos: { 1: 0 } }),
    );
    expect((await pedir('10:45')).resultado).toBe('criada');
  });
});
