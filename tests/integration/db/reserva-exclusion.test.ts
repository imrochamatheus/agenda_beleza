import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { conectar, criarCenario, criarProfissional, erroSql, inserirReserva } from '../../support/sql';

// CA-2..CA-8 (RN-7): reserva_sem_sobreposicao e reserva_ordem_chk, com PostgreSQL real.
let c: pg.Client;

beforeAll(async () => {
  c = await conectar();
});

afterAll(async () => {
  await c.end();
});

async function reservasDoProfissional(profissionalId: string): Promise<number> {
  const r = await c.query<{ n: number }>('SELECT count(*)::int AS n FROM reserva WHERE profissional_id = $1', [
    profissionalId,
  ]);
  return r.rows[0].n;
}

describe('reserva_sem_sobreposicao', () => {
  it('CA-2: rejeita reserva ativa sobreposta do mesmo profissional com 23P01 e nada é gravado', async () => {
    const s = await criarCenario(c);
    await inserirReserva(c, { ...s, inicio: '2026-12-01T10:00:00Z', fim: '2026-12-01T11:00:00Z' });
    const erro = await erroSql(
      inserirReserva(c, { ...s, inicio: '2026-12-01T10:30:00Z', fim: '2026-12-01T11:30:00Z' }),
    );
    expect(erro).toEqual({ code: '23P01', constraint: 'reserva_sem_sobreposicao' });
    expect(await reservasDoProfissional(s.profissionalId)).toBe(1);
  });

  it('CA-3: aceita a sobreposição quando a primeira reserva está cancelada', async () => {
    const s = await criarCenario(c);
    await inserirReserva(c, {
      ...s,
      inicio: '2026-12-01T10:00:00Z',
      fim: '2026-12-01T11:00:00Z',
      status: 'cancelado',
    });
    await inserirReserva(c, { ...s, inicio: '2026-12-01T10:30:00Z', fim: '2026-12-01T11:30:00Z' });
    expect(await reservasDoProfissional(s.profissionalId)).toBe(2);
  });

  it.each(['concluido', 'nao_compareceu'] as const)(
    'CA-3 (predicado, R-5): reserva %s também ocupa o horário',
    async (status) => {
      const s = await criarCenario(c);
      await inserirReserva(c, { ...s, inicio: '2026-12-01T10:00:00Z', fim: '2026-12-01T11:00:00Z', status });
      const erro = await erroSql(
        inserirReserva(c, { ...s, inicio: '2026-12-01T10:30:00Z', fim: '2026-12-01T11:30:00Z' }),
      );
      expect(erro).toEqual({ code: '23P01', constraint: 'reserva_sem_sobreposicao' });
    },
  );

  it('CA-4: com intervalo 0, reservas adjacentes ([) ) do mesmo profissional são aceitas', async () => {
    const s = await criarCenario(c);
    await inserirReserva(c, { ...s, inicio: '2026-12-01T10:00:00Z', fim: '2026-12-01T11:00:00Z' });
    await inserirReserva(c, { ...s, inicio: '2026-12-01T11:00:00Z', fim: '2026-12-01T12:00:00Z' });
    expect(await reservasDoProfissional(s.profissionalId)).toBe(2);
  });

  it('CA-4 (limite): 1 segundo de sobreposição é rejeitado', async () => {
    const s = await criarCenario(c);
    await inserirReserva(c, { ...s, inicio: '2026-12-01T10:00:00Z', fim: '2026-12-01T11:00:00Z' });
    const erro = await erroSql(
      inserirReserva(c, { ...s, inicio: '2026-12-01T10:59:59Z', fim: '2026-12-01T12:00:00Z' }),
    );
    expect(erro).toEqual({ code: '23P01', constraint: 'reserva_sem_sobreposicao' });
  });

  it('CA-5: profissionais distintos do mesmo salão podem ter reservas sobrepostas', async () => {
    const s = await criarCenario(c);
    const outro = await criarProfissional(c, s.salaoId);
    await inserirReserva(c, { ...s, inicio: '2026-12-01T10:00:00Z', fim: '2026-12-01T11:00:00Z' });
    await inserirReserva(c, {
      ...s,
      profissionalId: outro,
      inicio: '2026-12-01T10:30:00Z',
      fim: '2026-12-01T11:30:00Z',
    });
    expect(await reservasDoProfissional(s.profissionalId)).toBe(1);
    expect(await reservasDoProfissional(outro)).toBe(1);
  });

  it('CA-6: o intervalo gravado em ocupado_ate bloqueia a reserva seguinte', async () => {
    const s = await criarCenario(c);
    await inserirReserva(c, {
      ...s,
      inicio: '2026-12-01T10:00:00Z',
      fim: '2026-12-01T10:30:00Z',
      ocupadoAte: '2026-12-01T10:45:00Z',
    });
    const erro = await erroSql(
      inserirReserva(c, { ...s, inicio: '2026-12-01T10:30:00Z', fim: '2026-12-01T11:00:00Z' }),
    );
    expect(erro).toEqual({ code: '23P01', constraint: 'reserva_sem_sobreposicao' });
    expect(await reservasDoProfissional(s.profissionalId)).toBe(1);
  });

  it('CA-7: reativar uma reserva cancelada sobre outra ativa é rejeitado e ela continua cancelada', async () => {
    const s = await criarCenario(c);
    const cancelada = await inserirReserva(c, {
      ...s,
      inicio: '2026-12-01T10:00:00Z',
      fim: '2026-12-01T11:00:00Z',
      status: 'cancelado',
    });
    await inserirReserva(c, { ...s, inicio: '2026-12-01T10:30:00Z', fim: '2026-12-01T11:30:00Z' });
    const erro = await erroSql(c.query("UPDATE reserva SET status = 'confirmado' WHERE id = $1", [cancelada]));
    expect(erro).toEqual({ code: '23P01', constraint: 'reserva_sem_sobreposicao' });
    const r = await c.query<{ status: string }>('SELECT status FROM reserva WHERE id = $1', [cancelada]);
    expect(r.rows[0].status).toBe('cancelado');
  });

  it('virada de dia: o resultado não depende do TimeZone da sessão (America/Sao_Paulo)', async () => {
    const s = await criarCenario(c);
    const local = await conectar();
    try {
      await local.query("SET TIME ZONE 'America/Sao_Paulo'");
      await inserirReserva(local, { ...s, inicio: '2026-12-01T23:30:00Z', fim: '2026-12-02T00:30:00Z' });
      const erro = await erroSql(
        inserirReserva(local, { ...s, inicio: '2026-12-02T00:00:00Z', fim: '2026-12-02T01:00:00Z' }),
      );
      expect(erro).toEqual({ code: '23P01', constraint: 'reserva_sem_sobreposicao' });
      // Adjacente depois da meia-noite UTC: aceita.
      await inserirReserva(local, { ...s, inicio: '2026-12-02T00:30:00Z', fim: '2026-12-02T01:30:00Z' });
      // O instante gravado é o mesmo em UTC, qualquer que seja o fuso da sessão.
      const r = await local.query<{ utc: string }>(
        "SELECT to_char(min(inicio) AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI') AS utc FROM reserva WHERE profissional_id = $1",
        [s.profissionalId],
      );
      expect(r.rows[0].utc).toBe('2026-12-01T23:30');
    } finally {
      await local.end();
    }
    expect(await reservasDoProfissional(s.profissionalId)).toBe(2);
  });
});

describe('reserva_ordem_chk', () => {
  it.each([
    ['fim = inicio', '2026-12-01T10:00:00Z', '2026-12-01T10:00:00Z', '2026-12-01T10:00:00Z'],
    ['fim < inicio', '2026-12-01T10:00:00Z', '2026-12-01T09:00:00Z', '2026-12-01T09:00:00Z'],
    ['ocupado_ate < fim', '2026-12-01T10:00:00Z', '2026-12-01T11:00:00Z', '2026-12-01T10:30:00Z'],
  ])('CA-8: %s é rejeitado pelo CHECK com 23514', async (_caso, inicio, fim, ocupadoAte) => {
    const s = await criarCenario(c);
    const erro = await erroSql(inserirReserva(c, { ...s, inicio, fim, ocupadoAte }));
    expect(erro).toEqual({ code: '23514', constraint: 'reserva_ordem_chk' });
    expect(await reservasDoProfissional(s.profissionalId)).toBe(0);
  });
});
