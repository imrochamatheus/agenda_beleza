import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { criarReserva } from '@/server/reservas/criar-reserva';
import { obterPrisma } from '@/server/repos/db';

import { AGORA, DIA, contarLinhas, criarCenarioReserva, entradaReserva, inserirReservaDireta, sp } from '../../support/reservas';

// D-025 T-6a: CA-16 (encaixe da equipe; a constraint continua valendo).

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterAll(() => {
  vi.restoreAllMocks();
});

const enfileirar = async () => ({ criado: true as const, id: 'job' });
const encaixe = { modo: 'encaixe' as const };

describe('CA-16: encaixe', () => {
  it('fora da jornada, do funcionamento e sobre bloqueio: aceito com encaixe = true', async () => {
    const c = await criarCenarioReserva({ funcionamento: { 2: [['10:00', '12:00']] } });
    await obterPrisma().bloqueio.create({ data: { salaoId: c.s.salaoId, profissionalId: c.ana, inicio: sp(DIA, '14:00'), fim: sp(DIA, '15:00') } });
    for (const hhmm of ['07:00', '14:00', '22:30']) {
      const r = await criarReserva(c.ctxEquipe, entradaReserva(c, { inicio: sp(DIA, hhmm), ...encaixe }), { enfileirar });
      expect(r.resultado, hhmm).toBe('criada');
      if (r.resultado === 'criada') expect(r.reserva.encaixe).toBe(true);
    }
    const linhas = await obterPrisma().reserva.findMany({ where: { salaoId: c.s.salaoId } });
    expect(linhas).toHaveLength(3);
    expect(linhas.every((l) => l.encaixe)).toBe(true);
  });

  it('sobreposto a outra reserva ativa do mesmo profissional: 23P01', async () => {
    const c = await criarCenarioReserva();
    await inserirReservaDireta(c, { inicio: sp(DIA, '22:00'), fim: sp(DIA, '22:30') });
    const antes = await contarLinhas(c.s.salaoId);
    const r = await criarReserva(c.ctxEquipe, entradaReserva(c, { inicio: sp(DIA, '22:00'), ...encaixe }), { enfileirar });
    expect(r).toEqual({ resultado: 'horario_indisponivel', causa: '23P01' });
    expect(await contarLinhas(c.s.salaoId)).toEqual(antes);
  });

  it('no passado → invalido/inicio; no público → RangeError', async () => {
    const c = await criarCenarioReserva();
    const passado = new Date(AGORA.getTime() - 60 * 60_000);
    const r = await criarReserva(c.ctxEquipe, entradaReserva(c, { inicio: passado, ...encaixe }), { enfileirar });
    expect(r.resultado).toBe('invalido');
    expect(r.resultado === 'invalido' && Object.keys(r.erros)).toEqual(['inicio']);
    await expect(criarReserva(c.ctxSistema, entradaReserva(c, { ...encaixe }), { enfileirar })).rejects.toThrow(RangeError);
    expect((await contarLinhas(c.s.salaoId)).reserva).toBe(0);
  });

  it('profissional inativo ou sem vínculo continua recusado', async () => {
    const c = await criarCenarioReserva();
    expect(await criarReserva(c.ctxEquipe, entradaReserva(c, { profissionalId: c.s.profissionalInativoId, ...encaixe }), { enfileirar })).toEqual({
      resultado: 'profissional_indisponivel',
    });
    expect(await criarReserva(c.ctxEquipe, entradaReserva(c, { profissionalId: c.bia, servicoIds: [c.A, c.B], ...encaixe }), { enfileirar })).toEqual({
      resultado: 'profissional_indisponivel',
    });
  });
});
