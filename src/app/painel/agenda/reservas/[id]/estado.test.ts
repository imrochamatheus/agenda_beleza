import { describe, expect, it } from 'vitest';

import {
  estadoRemarcarInicial,
  lerFormularioRemarcar,
  lerResultadoPrg,
  MENSAGEM_DO_RESULTADO,
  MENSAGENS_FORMULARIO_ALTERACAO,
  paraEstadoRemarcar,
  resultadoPrgDeStatus,
} from './estado';
import type { ValoresRemarcar } from './estado';

// D-030 CA-13: conversão dos formulários e dos resultados (sem next/*).
const valores: ValoresRemarcar = { data: '2026-12-01', hora: '10:00', profissionalId: 'p1', servicoIds: ['s1'], confirmarEncaixe: false };

describe('lerResultadoPrg', () => {
  it('aceita só a lista fechada', () => {
    expect(lerResultadoPrg('cancelada')).toBe('cancelada');
    expect(lerResultadoPrg('remarcada')).toBe('remarcada');
    expect(lerResultadoPrg('<script>')).toBeNull();
    expect(lerResultadoPrg(['cancelada'])).toBeNull();
    expect(lerResultadoPrg(undefined)).toBeNull();
    expect(MENSAGEM_DO_RESULTADO.cancelada).toBe('Reserva cancelada.');
    expect(MENSAGEM_DO_RESULTADO.remarcada).toBe('Reserva atualizada.');
  });
});

describe('lerFormularioRemarcar', () => {
  it('lê só os campos conhecidos e corta o eco nos tetos', () => {
    const fd = new FormData();
    fd.set('reservaId', 'r1');
    fd.set('data', '2026-12-01999');
    fd.set('hora', '10:0099');
    fd.set('profissionalId', 'p'.repeat(60));
    fd.append('s', 'a');
    fd.append('s', 'b');
    fd.set('confirmarEncaixe', 'on');
    fd.set('extra', 'x');
    fd.set('arquivo', new File(['x'], 'a.txt'));
    const { entrada, valores: v } = lerFormularioRemarcar(fd);
    expect(entrada).toMatchObject({ reservaId: 'r1', servicoIds: ['a', 'b'], confirmarEncaixe: 'on', data: '2026-12-01999' });
    expect(v).toEqual({ data: '2026-12-01', hora: '10:00', profissionalId: 'p'.repeat(40), servicoIds: ['a', 'b'], confirmarEncaixe: true });
  });
  it('campos ausentes viram texto vazio', () => {
    const { entrada, valores: v } = lerFormularioRemarcar(new FormData());
    expect(entrada).toMatchObject({ reservaId: '', data: '', hora: '', profissionalId: '', servicoIds: [], confirmarEncaixe: null });
    expect(v.confirmarEncaixe).toBe(false);
  });
});

describe('paraEstadoRemarcar', () => {
  it('cada desfecho tem o seu estado, preservando os valores', () => {
    const base = estadoRemarcarInicial(valores);
    expect(paraEstadoRemarcar({ resultado: 'encaixe_requer_confirmacao', motivos: ['bloqueado'] }, valores)).toMatchObject({ motivos: ['bloqueado'], valores });
    expect(paraEstadoRemarcar({ resultado: 'horario_indisponivel', causa: '23P01' }, valores).mensagem).toContain('não está mais disponível');
    expect(paraEstadoRemarcar({ resultado: 'servico_indisponivel' }, valores).erros.servicos).toBe(MENSAGENS_FORMULARIO_ALTERACAO.servicoIndisponivel);
    expect(paraEstadoRemarcar({ resultado: 'profissional_indisponivel' }, valores).erros.profissional).toBe(MENSAGENS_FORMULARIO_ALTERACAO.profissionalIndisponivel);
    expect(paraEstadoRemarcar({ resultado: 'invalido', erros: { inicio: 'x', servicos: 'y' } }, valores)).toMatchObject({ erros: { data: 'x', servicos: 'y' }, mensagem: null });
    expect(paraEstadoRemarcar({ resultado: 'invalido', erros: {} }, valores).mensagem).toBeTruthy();
    expect(paraEstadoRemarcar({ resultado: 'recusado', motivo: 'sem_alteracao' }, valores).mensagem).toContain('Nenhuma alteração');
    expect(paraEstadoRemarcar({ resultado: 'recusado', motivo: 'reserva_final' }, valores).mensagem).toContain('cancelada');
    const ok = paraEstadoRemarcar({ resultado: 'atualizada', reserva: {} as never, mensagem: { mensagemId: 'm', estado: 'pendente' } }, valores);
    expect(ok).toEqual(base);
  });
});

describe('resultadoPrgDeStatus', () => {
  it('mapeia o status gravado ao código do PRG', () => {
    const r = (status: 'cancelado' | 'concluido' | 'nao_compareceu') => resultadoPrgDeStatus({ resultado: 'atualizada', status, revisao: 0, mensagem: null });
    expect([r('cancelado'), r('concluido'), r('nao_compareceu')]).toEqual(['cancelada', 'concluida', 'nao_compareceu']);
  });
});
