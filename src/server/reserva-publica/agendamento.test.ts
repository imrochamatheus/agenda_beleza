import { describe, expect, it } from 'vitest';

import { decidirEstadoEfetivo, TABELA_CAPACIDADES } from '@/domain/assinatura';
import type { SituacaoOperacional } from '@/domain/assinatura';

import { agendamentoDisponivel } from './agendamento';
import type { EstadoAgendamento } from './agendamento';

const AGORA = new Date('2026-11-20T12:00:00Z');
const base = (o: Partial<EstadoAgendamento> = {}): EstadoAgendamento => ({
  suspensoManual: false,
  agendar: true,
  servicosOfertaveis: 2,
  ...o,
});

describe('agendamentoDisponivel (CA-4, D-038 §3.4)', () => {
  it('com `agendar` e serviço: disponível', () => {
    expect(agendamentoDisponivel(base())).toEqual({ disponivel: true });
  });

  it('`agendar` negado: indisponível por assinatura', () => {
    expect(agendamentoDisponivel(base({ agendar: false }))).toEqual({ disponivel: false, motivo: 'assinatura' });
  });

  it('suspensão manual vence qualquer outro motivo', () => {
    expect(agendamentoDisponivel(base({ suspensoManual: true, agendar: false, servicosOfertaveis: 0 }))).toEqual({
      disponivel: false,
      motivo: 'suspenso_manual',
    });
  });

  it('assinatura bloqueada vem antes de "sem serviço"', () => {
    expect(agendamentoDisponivel(base({ agendar: false, servicosOfertaveis: 0 }))).toEqual({
      disponivel: false,
      motivo: 'assinatura',
    });
  });

  it('nenhum serviço ofertável: indisponível', () => {
    expect(agendamentoDisponivel(base({ servicosOfertaveis: 0 }))).toEqual({ disponivel: false, motivo: 'sem_servico' });
  });

  it('valor não booleano em `agendar` não libera (falha fechada)', () => {
    expect(agendamentoDisponivel(base({ agendar: 'true' as unknown as boolean })).disponivel).toBe(false);
  });
});

describe('equivalência tabela x agendamentoDisponivel (R-3)', () => {
  const depois = new Date(AGORA.getTime() + 1);
  const casos: [string, Parameters<typeof decidirEstadoEfetivo>[0], SituacaoOperacional][] = [
    ['sem assinatura', { suspensoManualEm: null, assinatura: null }, 'sem_assinatura'],
    ['pendente', { suspensoManualEm: null, assinatura: { estado: 'pendente', carenciaAte: null, acessoAte: null } }, 'pendente'],
    ['em_teste', { suspensoManualEm: null, assinatura: { estado: 'em_teste', carenciaAte: null, acessoAte: null } }, 'em_teste'],
    ['ativa', { suspensoManualEm: null, assinatura: { estado: 'ativa', carenciaAte: null, acessoAte: null } }, 'ativa'],
    ['em_carencia', { suspensoManualEm: null, assinatura: { estado: 'em_carencia', carenciaAte: depois, acessoAte: null } }, 'em_carencia'],
    ['suspensa', { suspensoManualEm: null, assinatura: { estado: 'suspensa', carenciaAte: null, acessoAte: null } }, 'suspensa'],
    ['cancelada vigente', { suspensoManualEm: null, assinatura: { estado: 'cancelada', carenciaAte: null, acessoAte: depois } }, 'cancelada'],
    ['cancelada vencida', { suspensoManualEm: null, assinatura: { estado: 'cancelada', carenciaAte: null, acessoAte: AGORA } }, 'encerrada'],
    ['encerrada', { suspensoManualEm: null, assinatura: { estado: 'encerrada', carenciaAte: null, acessoAte: null } }, 'encerrada'],
    ['manual sobre ativa', { suspensoManualEm: AGORA, assinatura: { estado: 'ativa', carenciaAte: null, acessoAte: null } }, 'manual'],
  ];
  it.each(casos)('%s', (_n, bruto, situacao) => {
    const e = decidirEstadoEfetivo(bruto, AGORA);
    const r = agendamentoDisponivel({
      suspensoManual: e.motivo === 'manual',
      agendar: e.capacidades.agendar,
      servicosOfertaveis: 1,
    });
    expect(r.disponivel).toBe(TABELA_CAPACIDADES[situacao].agendar);
  });
});
