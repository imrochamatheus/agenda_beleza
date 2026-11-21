import { describe, expect, it } from 'vitest';

import type { EntradaReservaPublica } from '@/server/reserva-publica/tipos';

import { EQUIPE_DEMO, SERVICOS_DEMO } from './dados';
import { demonstrarReserva } from './demonstracao';

const OK = { cliente: { ok: true as const }, aceites: { ok: true as const } };
const ENTRADA: EntradaReservaPublica = {
  slug: 'demonstracao',
  servicoIds: [SERVICOS_DEMO[0].id, SERVICOS_DEMO[1].id],
  profissionalId: EQUIPE_DEMO[0].id,
  inicio: '2026-12-02T13:00:00.000Z',
  nome: 'Maria',
  telefone: '11987654321',
  aceites: {},
  chaveRequisicao: 'x',
  ip: 'desconhecido',
  tokenHumano: null,
};

describe('demonstrarReserva', () => {
  it('válida: confirmada com os serviços, total e duração', () => {
    const r = demonstrarReserva(ENTRADA, OK);
    expect(r).toMatchObject({
      resultado: 'confirmada',
      resumo: { profissionalNome: 'Ana', totalCentavos: 14500, duracaoTotalMin: 90, inicioIso: '2026-12-02T13:00:00.000Z' },
    });
  });

  it('erros de cliente e de consentimento juntos', () => {
    const r = demonstrarReserva(ENTRADA, {
      cliente: { ok: false, erros: { nome: 'N', telefone: 'T' } },
      aceites: { ok: false, erros: { mensagensReserva: 'C' } },
    });
    expect(r).toEqual({ resultado: 'invalido', erros: { nome: 'N', telefone: 'T', mensagensReserva: 'C' } });
  });

  it('serviço, horário ou profissional adulterados: inválido genérico', () => {
    for (const sobre of [{ servicoIds: ['x'] }, { inicio: 'x' }, { profissionalId: 'x' }]) {
      expect(demonstrarReserva({ ...ENTRADA, ...sobre }, OK).resultado).toBe('invalido');
    }
  });
});
