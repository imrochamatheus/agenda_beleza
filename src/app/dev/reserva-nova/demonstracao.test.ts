import { describe, expect, it } from 'vitest';

import type { EntradaReservaEquipe } from '@/server/reservas/tipos';

import { ANA_DEMO, BIA_DEMO, demonstrarReservaManual, SERVICOS_DEMO } from './demonstracao';

// D-029: a demonstração usa as mesmas funções puras do serviço (CA-1, CA-6, CA-7, CA-8, CA-9, CA-16).
const AGORA = new Date('2026-11-20T12:00:00Z');
const entrada = (sobre: Partial<EntradaReservaEquipe> = {}): EntradaReservaEquipe => ({
  servicoIds: [SERVICOS_DEMO[0].id],
  profissionalId: ANA_DEMO.id,
  data: '2026-12-01', // terça
  hora: '10:00',
  nome: 'Maria Souza',
  telefone: '(11) 91234-5678',
  aceites: { mensagensReserva: 'on' },
  confirmarEncaixe: undefined,
  chaveRequisicao: null,
  ...sobre,
});
const motivos = (r: ReturnType<typeof demonstrarReservaManual>) => (r.resultado === 'encaixe_requer_confirmacao' ? r.motivos : null);

describe('demonstrarReservaManual', () => {
  it('horário normal: criada sem encaixe, mensagem pendente só com aceite', () => {
    const r = demonstrarReservaManual(entrada(), AGORA);
    expect(r.resultado === 'criada' && r.reserva.encaixe).toBe(false);
    expect(r.resultado === 'criada' && r.confirmacao.estado).toBe('pendente');
    const s = demonstrarReservaManual(entrada({ aceites: {} }), AGORA);
    expect(s.resultado === 'criada' && s.confirmacao.estado).toBe('nao_enviada');
  });
  it('fora da jornada, bloqueio (só da Ana) e sábado fechado pedem confirmação; confirmando vira encaixe', () => {
    expect(motivos(demonstrarReservaManual(entrada({ hora: '18:30' }), AGORA))).toEqual(['fora_da_jornada']);
    expect(motivos(demonstrarReservaManual(entrada({ hora: '14:00' }), AGORA))).toEqual(['bloqueado']);
    expect(demonstrarReservaManual(entrada({ hora: '14:00', profissionalId: BIA_DEMO.id }), AGORA).resultado).toBe('criada');
    expect(motivos(demonstrarReservaManual(entrada({ data: '2026-12-05' }), AGORA))).toEqual(['fora_do_funcionamento']);
    const c = demonstrarReservaManual(entrada({ hora: '18:30', confirmarEncaixe: 'on' }), AGORA);
    expect(c.resultado === 'criada' && c.reserva.encaixe).toBe(true);
  });
  it('passado, serviço, profissional e campos inválidos', () => {
    expect(demonstrarReservaManual(entrada({ data: '2026-11-20', hora: '08:00' }), AGORA)).toMatchObject({ resultado: 'invalido', erros: { inicio: expect.any(String) } });
    expect(demonstrarReservaManual(entrada({ servicoIds: [] }), AGORA)).toMatchObject({ resultado: 'invalido', erros: { servicos: expect.any(String) } });
    expect(demonstrarReservaManual(entrada({ servicoIds: [SERVICOS_DEMO[0].id, SERVICOS_DEMO[0].id] }), AGORA).resultado).toBe('invalido');
    expect(demonstrarReservaManual(entrada({ profissionalId: 'x' }), AGORA).resultado).toBe('profissional_indisponivel');
    const r = demonstrarReservaManual(entrada({ data: 'x', nome: '', telefone: '1' }), AGORA);
    expect(r.resultado === 'invalido' && Object.keys(r.erros).sort()).toEqual(['inicio', 'nome', 'telefone']);
  });
});
