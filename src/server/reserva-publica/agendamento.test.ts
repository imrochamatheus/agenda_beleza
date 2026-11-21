import { describe, expect, it } from 'vitest';

import { agendamentoDisponivel } from './agendamento';
import type { EstadoAgendamento, EstadoDaAssinatura } from './agendamento';

const AGORA = new Date('2026-11-20T12:00:00Z');
const base = (o: Partial<EstadoAgendamento> = {}): EstadoAgendamento => ({
  suspensoManualEm: null,
  assinatura: null,
  servicosOfertaveis: 2,
  agora: AGORA,
  ...o,
});
const com = (estado: EstadoDaAssinatura, acessoAte: Date | null = null) => base({ assinatura: { estado, acessoAte } });

describe('agendamentoDisponivel (CA-4)', () => {
  it('sem assinatura (legado/seed) e com serviço: disponível', () => {
    expect(agendamentoDisponivel(base())).toEqual({ disponivel: true });
  });

  it.each(['em_teste', 'ativa', 'em_carencia'] as const)('assinatura %s: disponível', (estado) => {
    expect(agendamentoDisponivel(com(estado))).toEqual({ disponivel: true });
  });

  it.each(['pendente', 'suspensa', 'encerrada'] as const)('assinatura %s: indisponível por assinatura', (estado) => {
    expect(agendamentoDisponivel(com(estado))).toEqual({ disponivel: false, motivo: 'assinatura' });
  });

  it('cancelada: só até acessoAte (exclusivo)', () => {
    const depois = new Date(AGORA.getTime() + 1);
    expect(agendamentoDisponivel(com('cancelada', depois))).toEqual({ disponivel: true });
    expect(agendamentoDisponivel(com('cancelada', AGORA))).toEqual({ disponivel: false, motivo: 'assinatura' });
    expect(agendamentoDisponivel(com('cancelada', null))).toEqual({ disponivel: false, motivo: 'assinatura' });
  });

  it('suspensão manual vence qualquer outro estado', () => {
    const r = agendamentoDisponivel({ ...com('ativa'), suspensoManualEm: AGORA, servicosOfertaveis: 0 });
    expect(r).toEqual({ disponivel: false, motivo: 'suspenso_manual' });
  });

  it('assinatura bloqueada vem antes de "sem serviço"', () => {
    expect(agendamentoDisponivel({ ...com('suspensa'), servicosOfertaveis: 0 })).toEqual({
      disponivel: false,
      motivo: 'assinatura',
    });
  });

  it('nenhum serviço ofertável: indisponível', () => {
    expect(agendamentoDisponivel(base({ servicosOfertaveis: 0 }))).toEqual({ disponivel: false, motivo: 'sem_servico' });
  });
});
