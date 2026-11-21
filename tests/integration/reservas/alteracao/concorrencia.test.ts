import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { cancelarReserva } from '@/server/reservas/cancelar';
import { marcarStatusReserva } from '@/server/reservas/marcar-status';
import { remarcarReserva } from '@/server/reservas/remarcar';

import { esperarTrava } from '../../../support/reservas';
import { conectar } from '../../../support/sql';

import { AGORA, criarCenario, criarConfirmada, db, DIA, filaEspia, mensagensDe, reservaDe, sp } from './apoio';

// D-030: concorrência de remarcar, cancelar e marcar status. Nenhum 5xx nem impasse (40P01); a trava do
// profissional (FOR NO KEY UPDATE, em ordem de id) e a da reserva (FOR UPDATE, por último) serializam.

let cx: pg.Client;
beforeAll(async () => {
  cx = await conectar();
});
afterAll(async () => {
  await cx.end();
  vi.restoreAllMocks();
});
beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

const entrada = (c: Awaited<ReturnType<typeof criarCenario>>, reservaId: string, sobre: Record<string, unknown> = {}) => ({
  reservaId,
  data: '2026-12-01',
  hora: '15:00',
  profissionalId: c.ana,
  servicoIds: [c.A],
  ...sobre,
});

describe('remarcar × remarcar para o mesmo horário', () => {
  it('10 reservas distintas da mesma profissional para 15:00: exatamente 1 atualizada, 9 horario_indisponivel', async () => {
    const c = await criarCenario();
    const ids: string[] = [];
    for (let i = 0; i < 10; i += 1) ids.push(await criarConfirmada(c, { hora: `${String(9 + (i % 5)).padStart(2, '0')}:${i < 5 ? '00' : '30'}` }));
    const rs = await Promise.all(ids.map((id) => remarcarReserva(c.ctxEquipe, entrada(c, id), AGORA, { enfileirar: filaEspia().enfileirar })));
    expect(rs.filter((r) => r.resultado === 'atualizada')).toHaveLength(1);
    for (const r of rs.filter((x) => x.resultado !== 'atualizada')) expect(r).toEqual({ resultado: 'horario_indisponivel', causa: '23P01' });
    const na15 = await db().reserva.count({ where: { salaoId: c.s.salaoId, inicio: sp(DIA, '15:00') } });
    expect(na15).toBe(1);
  });

  it('a mesma reserva remarcada 10 vezes em paralelo: serializa; cada sucesso incrementa a revisão uma vez', async () => {
    const c = await criarCenario();
    const id = await criarConfirmada(c, { hora: '09:00' });
    const rs = await Promise.all(
      Array.from({ length: 10 }, (_, i) => remarcarReserva(c.ctxEquipe, entrada(c, id, { hora: i < 9 ? `${10 + i}:00` : '09:30' }), AGORA, { enfileirar: filaEspia().enfileirar })),
    );
    const ok = rs.filter((r) => r.resultado === 'atualizada');
    // Todos os horários são distintos entre si e do inicial (09:00), dentro da jornada: todas vencem, uma de
    // cada vez, e a própria reserva nunca conflita consigo (CA-5).
    expect(ok).toHaveLength(10);
    const linha = await reservaDe(id);
    expect(linha.revisao).toBe(ok.length);
    const remarcacoes = (await mensagensDe(id)).filter((m) => m.tipo === 'remarcacao');
    expect(remarcacoes.map((m) => m.revisao)).toEqual(Array.from({ length: ok.length }, (_, i) => i + 1));
    expect(remarcacoes.filter((m) => m.estado === 'pendente')).toHaveLength(1);
  });
});

describe('troca cruzada de profissionais (sem impasse)', () => {
  it('Ana→Bia e Bia→Ana em paralelo, 5 rodadas: ambas atualizadas', async () => {
    for (let i = 0; i < 5; i += 1) {
      const c = await criarCenario();
      const deAna = await criarConfirmada(c, { hora: '10:00' });
      const deBia = await criarConfirmada(c, { hora: '12:00', profissionalId: c.bia });
      const [a, b] = await Promise.all([
        remarcarReserva(c.ctxEquipe, entrada(c, deAna, { profissionalId: c.bia, hora: '16:00' }), AGORA, { enfileirar: filaEspia().enfileirar }),
        remarcarReserva(c.ctxEquipe, entrada(c, deBia, { profissionalId: c.ana, hora: '17:00' }), AGORA, { enfileirar: filaEspia().enfileirar }),
      ]);
      expect([a.resultado, b.resultado]).toEqual(['atualizada', 'atualizada']);
    }
  });

  it('determinístico (pg_stat_activity): com o profissional de maior id travado por fora, as duas esperam e concluem sem 40P01', async () => {
    const c = await criarCenario();
    const deAna = await criarConfirmada(c, { hora: '10:00' });
    const deBia = await criarConfirmada(c, { hora: '12:00', profissionalId: c.bia });
    const maior = [c.ana, c.bia].sort().at(-1)!;
    const ext = await conectar();
    try {
      await ext.query('BEGIN');
      await ext.query('SELECT id FROM profissional WHERE id = $1 FOR UPDATE', [maior]);
      const t1 = remarcarReserva(c.ctxEquipe, entrada(c, deAna, { profissionalId: c.bia, hora: '16:00' }), AGORA, { enfileirar: filaEspia().enfileirar });
      const t2 = remarcarReserva(c.ctxEquipe, entrada(c, deBia, { profissionalId: c.ana, hora: '17:00' }), AGORA, { enfileirar: filaEspia().enfileirar });
      await esperarTrava(cx, 'FOR NO KEY UPDATE OF p', 2);
      await ext.query('COMMIT');
      const [a, b] = await Promise.all([t1, t2]);
      expect([a.resultado, b.resultado]).toEqual(['atualizada', 'atualizada']);
    } finally {
      await ext.query('ROLLBACK').catch(() => {});
      await ext.end();
    }
  });
});

describe('cancelar × remarcar e status × cancelar na mesma reserva', () => {
  it('cancelar × remarcar: estado final cancelado, uma só mensagem de cancelamento e desfecho coerente', async () => {
    for (let i = 0; i < 4; i += 1) {
      const c = await criarCenario();
      const id = await criarConfirmada(c);
      const [cancelamento, remarcacao] = await Promise.all([
        cancelarReserva(c.ctxEquipe, { reservaId: id }, AGORA, { enfileirar: filaEspia().enfileirar }),
        remarcarReserva(c.ctxEquipe, entrada(c, id, { hora: '14:00' }), AGORA, { enfileirar: filaEspia().enfileirar }),
      ]);
      expect(cancelamento.resultado).toBe('atualizada');
      const linha = await reservaDe(id);
      expect(linha.status).toBe('cancelado');
      const msgs = await mensagensDe(id);
      expect(msgs.filter((m) => m.tipo === 'cancelamento')).toHaveLength(1);
      if (remarcacao.resultado === 'atualizada') {
        expect(linha.revisao).toBe(1);
        expect(msgs.find((m) => m.tipo === 'cancelamento')!.revisao).toBe(1);
      } else {
        expect(remarcacao).toEqual({ resultado: 'recusado', motivo: 'reserva_final' });
        expect(linha.revisao).toBe(0);
      }
      expect(msgs.filter((m) => m.estado === 'pendente').map((m) => m.tipo)).toEqual(['cancelamento']);
    }
  });

  it('concluir × cancelar: exatamente um vence; o outro é recusado pela máquina', async () => {
    for (let i = 0; i < 4; i += 1) {
      const c = await criarCenario();
      const id = await criarConfirmada(c);
      const durante = sp(DIA, '10:10');
      const [a, b] = await Promise.all([
        marcarStatusReserva(c.ctxEquipe, { reservaId: id, para: 'concluido' }, durante, { enfileirar: filaEspia().enfileirar }),
        cancelarReserva(c.ctxEquipe, { reservaId: id }, durante, { enfileirar: filaEspia().enfileirar }),
      ]);
      expect([a, b].filter((r) => r.resultado === 'atualizada')).toHaveLength(1);
      const perdedor = [a, b].find((r) => r.resultado === 'recusado');
      expect(perdedor).toMatchObject({ resultado: 'recusado', motivo: expect.stringMatching(/transicao_invalida|reserva_final/) });
      expect((await reservaDe(id)).status).toBe(a.resultado === 'atualizada' ? 'concluido' : 'cancelado');
    }
  });

  it('cancelar × cancelar: um só cancelamento e uma só mensagem', async () => {
    const c = await criarCenario();
    const id = await criarConfirmada(c);
    const rs = await Promise.all(Array.from({ length: 5 }, () => cancelarReserva(c.ctxEquipe, { reservaId: id }, AGORA, { enfileirar: filaEspia().enfileirar })));
    expect(rs.filter((r) => r.resultado === 'atualizada')).toHaveLength(1);
    expect((await mensagensDe(id)).filter((m) => m.tipo === 'cancelamento')).toHaveLength(1);
  });
});
