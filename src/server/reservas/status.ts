// Máquina de status da reserva (D-030 RN-3, S2). Pura: sem I/O, sem relógio implícito (`agora` é entrada),
// sem next/*. "Terminada" = `agora >= fim` (o fim do atendimento, não `ocupado_ate`).
import type { StatusReserva } from '@/server/repos/tipos';

export type MotivoRecusaDeStatus = 'transicao_invalida' | 'ainda_nao_iniciada' | 'ja_terminada' | 'reserva_final';

export type DecisaoDeTransicao = { ok: true } | { ok: false; motivo: MotivoRecusaDeStatus };

export type EntradaDeTransicao = { de: StatusReserva; para: StatusReserva; inicio: Date; fim: Date; agora: Date };

export function decidirTransicao({ de, para, inicio, fim, agora }: EntradaDeTransicao): DecisaoDeTransicao {
  if (de === 'cancelado') return { ok: false, motivo: 'reserva_final' };
  if (de === para) return { ok: false, motivo: 'transicao_invalida' };
  if (de === 'confirmado' && para === 'cancelado') {
    return agora.getTime() < fim.getTime() ? { ok: true } : { ok: false, motivo: 'ja_terminada' };
  }
  if (de === 'confirmado' && (para === 'concluido' || para === 'nao_compareceu')) {
    return agora.getTime() >= inicio.getTime() ? { ok: true } : { ok: false, motivo: 'ainda_nao_iniciada' };
  }
  if ((de === 'concluido' && para === 'nao_compareceu') || (de === 'nao_compareceu' && para === 'concluido')) {
    return { ok: true };
  }
  return { ok: false, motivo: 'transicao_invalida' };
}

/** Só `confirmado` pode ser remarcada (RN-3). */
export function podeRemarcar(status: StatusReserva): boolean {
  return status === 'confirmado';
}

export type AcoesPermitidas = { remarcar: boolean; cancelar: boolean; concluir: boolean; naoCompareceu: boolean };

/** Quais botões o detalhe mostra: exatamente o que a máquina aceitaria agora. */
export function acoesPermitidas(r: { status: StatusReserva; inicio: Date; fim: Date; agora: Date }): AcoesPermitidas {
  const ok = (para: StatusReserva) => decidirTransicao({ ...r, de: r.status, para }).ok;
  return {
    remarcar: podeRemarcar(r.status),
    cancelar: ok('cancelado'),
    concluir: ok('concluido'),
    naoCompareceu: ok('nao_compareceu'),
  };
}
