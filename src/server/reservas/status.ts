// Máquina de status por ITEM de reserva (D-030 RN-3, S2; D-050 RN-20: cada item segue a máquina, e o status
// da reserva é derivado em itens.ts). Pura: sem I/O, sem relógio implícito (`agora` é entrada), sem next/*.
// "Terminado" = `agora >= fim` do item (o fim do atendimento, não `ocupado_ate`).
import type { StatusReserva } from '@/server/repos/tipos';

export type MotivoRecusaDeStatus = 'transicao_invalida' | 'ainda_nao_iniciada' | 'ja_terminada' | 'item_final';

export type DecisaoDeTransicao = { ok: true } | { ok: false; motivo: MotivoRecusaDeStatus };

export type EntradaDeTransicao = { de: StatusReserva; para: StatusReserva; inicio: Date; fim: Date; agora: Date };

export function decidirTransicao({ de, para, inicio, fim, agora }: EntradaDeTransicao): DecisaoDeTransicao {
  if (de === 'cancelado') return { ok: false, motivo: 'item_final' };
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

/** Só item `confirmado` pode ser remarcado (D-050 RN-22). */
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

/**
 * D-050 RN-24: itens que "Cancelar todos" cancelaria agora = os que a máquina deixa cancelar (`confirmado` com
 * `agora < fim`), na ordem recebida.
 */
export function itensCancelaveis<T extends { status: StatusReserva; inicio: Date; fim: Date }>(itens: readonly T[], agora: Date): T[] {
  return itens.filter((i) => decidirTransicao({ de: i.status, para: 'cancelado', inicio: i.inicio, fim: i.fim, agora }).ok);
}

/**
 * O botão "Cancelar todos" só aparece com 2+ itens canceláveis (web-design §5.10; com 1, o "Cancelar" do item
 * resolve). A ação aceita a partir de 1 (RN-24: recusa só quando nenhum pode ser cancelado).
 */
export function podeCancelarTodos(itens: readonly { status: StatusReserva; inicio: Date; fim: Date }[], agora: Date): boolean {
  return itensCancelaveis(itens, agora).length >= 2;
}
