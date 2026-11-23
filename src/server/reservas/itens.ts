import type { StatusReserva } from '@/server/repos/tipos';
import { compararDatas, partesLocais } from '@/server/tempo/fuso';

// D-050 (E3.6) §3.2: derivação PURA dos campos de `reserva` a partir dos itens (A-1/A-2) e a checagem
// pura entre itens da mesma reserva (RN-8/RN-9). Fonte ÚNICA da regra: criação (T-5), operações por
// item (T-6), seed e fixtures E2E (T-14) e o verificador `conferirDerivados` dos testes usam estas
// funções. Sem banco, sem `next/*`, sem relógio implícito (`agora` é entrada).

/** RN-21: prioridade do status derivado (o de menor posição vence). */
const PRIORIDADE: readonly StatusReserva[] = ['confirmado', 'concluido', 'nao_compareceu', 'cancelado'];

/** RN-21: confirmado > concluido > nao_compareceu > cancelado. Lista vazia → RangeError. */
export function derivarStatus(itens: readonly { status: StatusReserva }[]): StatusReserva {
  if (itens.length === 0) throw new RangeError('derivarStatus: reserva sem itens');
  let melhor = PRIORIDADE.length - 1;
  for (const i of itens) {
    const p = PRIORIDADE.indexOf(i.status);
    if (p < 0) throw new RangeError('derivarStatus: status desconhecido');
    if (p < melhor) melhor = p;
  }
  return PRIORIDADE[melhor];
}

/**
 * A-2: envelope `[min(inicio), max(fim))` sobre os itens NÃO cancelados; se todos estiverem cancelados,
 * sobre todos. Lista vazia → RangeError.
 */
export function envelope(itens: readonly { status: StatusReserva; inicio: Date; fim: Date }[]): { inicio: Date; fim: Date } {
  if (itens.length === 0) throw new RangeError('envelope: reserva sem itens');
  const ativos = itens.filter((i) => i.status !== 'cancelado');
  const base = ativos.length > 0 ? ativos : itens;
  let inicio = base[0].inicio.getTime();
  let fim = base[0].fim.getTime();
  for (const i of base) {
    inicio = Math.min(inicio, i.inicio.getTime());
    fim = Math.max(fim, i.fim.getTime());
  }
  return { inicio: new Date(inicio), fim: new Date(fim) };
}

export type DerivadosDaReserva = { status: StatusReserva; inicio: Date; fim: Date; canceladaEm: Date | null };

/**
 * status, inicio, fim e canceladaEm da reserva. `canceladaEm`: `agora` quando a reserva PASSA a
 * `cancelado` (anterior nulo ou não cancelado); a anterior quando já era `cancelado` (mantém o
 * instante); null quando não está cancelada.
 */
export function derivarReserva(
  itens: readonly { status: StatusReserva; inicio: Date; fim: Date }[],
  anterior: { status: StatusReserva; canceladaEm: Date | null } | null,
  agora: Date,
): DerivadosDaReserva {
  const status = derivarStatus(itens);
  const { inicio, fim } = envelope(itens);
  let canceladaEm: Date | null = null;
  if (status === 'cancelado') {
    canceladaEm = anterior !== null && anterior.status === 'cancelado' && anterior.canceladaEm !== null ? anterior.canceladaEm : agora;
  }
  return { status, inicio, fim, canceladaEm };
}

export type ItemParaConferir = {
  profissionalId: string;
  status: StatusReserva;
  inicio: Date;
  fim: Date;
  ocupadoAte: Date;
};

export type ResultadoConferenciaDeItens =
  | { ok: true }
  /** Itens (índices) cuja data local difere da do 1º item não cancelado. */
  | { ok: false; motivo: 'data_diferente'; itens: number[] }
  /**
   * RN-8/RN-9: `conflitos[k] = j` (j < k): o item k (o de MAIOR índice do par) cruza o item j.
   * `itens` = chaves de `conflitos`, em ordem crescente.
   */
  | { ok: false; motivo: 'entre_itens'; itens: number[]; conflitos: Record<number, number> };

const cruza = (a0: Date, a1: Date, b0: Date, b1: Date): boolean =>
  a0.getTime() < b1.getTime() && b0.getTime() < a1.getTime();

/**
 * Checagem pura entre os itens de UMA reserva, ANTES de qualquer INSERT/UPDATE (dba.md M-6: a exclusion
 * por profissional dispararia antes e viraria um 23P01 enganoso). Itens `cancelado` são ignorados.
 * 1. Todos os itens na mesma data local (no `fuso` do salão) do primeiro item não cancelado.
 * 2. RN-8: `[inicio, fim)` de dois itens nunca se cruzam (a cliente não está em dois lugares).
 * 3. RN-9: do MESMO profissional, `[inicio, ocupadoAte)` nunca se cruzam (o intervalo do salão conta).
 * O primeiro conflito de cada k (menor j) é o relatado. As mensagens ao usuário ficam no chamador.
 */
export function conferirItens(itens: readonly ItemParaConferir[], fuso: string): ResultadoConferenciaDeItens {
  const ativos = itens.map((i, k) => ({ i, k })).filter(({ i }) => i.status !== 'cancelado');
  if (ativos.length === 0) return { ok: true };

  const dataBase = partesLocais(ativos[0].i.inicio, fuso).data;
  const foraDaData = ativos.filter(({ i }) => compararDatas(partesLocais(i.inicio, fuso).data, dataBase) !== 0).map(({ k }) => k);
  if (foraDaData.length > 0) return { ok: false, motivo: 'data_diferente', itens: foraDaData };

  const conflitos: Record<number, number> = {};
  for (let b = 1; b < ativos.length; b++) {
    const { i: y, k } = ativos[b];
    for (let a = 0; a < b; a++) {
      const { i: x, k: j } = ativos[a];
      const mesmoProfissional = x.profissionalId.toLowerCase() === y.profissionalId.toLowerCase();
      const conflito =
        cruza(x.inicio, x.fim, y.inicio, y.fim) ||
        (mesmoProfissional && cruza(x.inicio, x.ocupadoAte, y.inicio, y.ocupadoAte));
      if (conflito) {
        conflitos[k] = j;
        break;
      }
    }
  }
  const indices = Object.keys(conflitos)
    .map(Number)
    .sort((p, q) => p - q);
  return indices.length === 0 ? { ok: true } : { ok: false, motivo: 'entre_itens', itens: indices, conflitos };
}
