import { describe, expect, it } from 'vitest';

import type { EntradaReservaPublica } from '@/server/reserva-publica/tipos';

import { EQUIPE_DEMO, SERVICOS_DEMO } from './dados';
import { demonstrarReserva } from './demonstracao';

const OK = { cliente: { ok: true as const }, aceites: { ok: true as const } };
const [ESCOVA, HIDRATACAO] = SERVICOS_DEMO.map((s) => s.id);
const [ANA, BIA] = EQUIPE_DEMO.map((p) => p.id);
const ENTRADA: EntradaReservaPublica = {
  slug: 'demonstracao',
  servicoIds: [ESCOVA, HIDRATACAO],
  // Fora de ordem de início de propósito: o resumo sai por horário.
  itens: [
    { servicoId: ESCOVA, profissionalId: ANA, inicio: '2026-12-02T14:00:00.000Z' },
    { servicoId: HIDRATACAO, profissionalId: BIA, inicio: '2026-12-02T13:00:00.000Z' },
  ],
  nome: 'Maria',
  telefone: '11987654321',
  aceites: {},
  chaveRequisicao: 'x',
  ip: 'desconhecido',
  tokenHumano: null,
};

describe('demonstrarReserva', () => {
  it('válida: um item por serviço, por início, com profissional, fim e total', () => {
    const r = demonstrarReserva(ENTRADA, OK);
    expect(r).toEqual({
      resultado: 'confirmada',
      repetida: false,
      resumo: {
        fuso: 'America/Sao_Paulo',
        data: '2026-12-02',
        itens: [
          { servicoNome: 'Hidratação', profissionalNome: 'Bia', inicioIso: '2026-12-02T13:00:00.000Z', fimIso: '2026-12-02T13:40:00.000Z', precoCentavos: 7500, duracaoMin: 40 },
          { servicoNome: 'Escova', profissionalNome: 'Ana', inicioIso: '2026-12-02T14:00:00.000Z', fimIso: '2026-12-02T15:00:00.000Z', precoCentavos: 9000, duracaoMin: 60 },
        ],
        totalCentavos: 16500,
      },
    });
  });

  it('erros de cliente e de consentimento juntos', () => {
    const r = demonstrarReserva(ENTRADA, {
      cliente: { ok: false, erros: { nome: 'N', telefone: 'T' } },
      aceites: { ok: false, erros: { mensagensReserva: 'C' } },
    });
    expect(r).toEqual({ resultado: 'invalido', erros: { nome: 'N', telefone: 'T', mensagensReserva: 'C' } });
  });

  it('serviço, horário, profissional ou contagem de itens adulterados: inválido genérico', () => {
    const item = ENTRADA.itens[0];
    for (const sobre of [
      { servicoIds: ['x'] },
      { itens: [ENTRADA.itens[0]] },
      { itens: [{ ...item, inicio: 'x' }, ENTRADA.itens[1]] },
      { itens: [{ ...item, profissionalId: 'x' }, ENTRADA.itens[1]] },
      { itens: [{ ...item, servicoId: HIDRATACAO }, ENTRADA.itens[1]] },
    ]) {
      expect(demonstrarReserva({ ...ENTRADA, ...sobre }, OK).resultado).toBe('invalido');
    }
  });
});
