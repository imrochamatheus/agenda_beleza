// Montagem pura dos itens e do intervalo da reserva (D-025 RN-1, RN-2). Aritmética em milissegundos
// UTC, sem `Intl`.
import type { ReservaDTO } from '@/server/repos/tipos';
import { validarServicos } from '@/server/disponibilidade/validacao';

import type { ItemDeReservaCriada, ReservaCriada } from './tipos';

const MIN_MS = 60_000;

export type ServicoParaItem = { servicoId: string; precoCentavos: number; duracaoMin: number };

export type ItensMontados =
  | { ok: true; itens: ItemDeReservaCriada[]; fim: Date; ocupadoAte: Date }
  | { ok: false; motivo: 'servicos_vazio' | 'servicos_repetidos' | 'servicos_demais' | 'duracao_invalida' };

/**
 * Itens consecutivos a partir de `inicio`, na ordem dada (`ordem` 0..n-1), com o snapshot de preço e
 * duração. `fim` = fim do último item; `ocupadoAte` = `fim` + `intervaloMin`.
 */
export function montarItens(inicio: Date, servicos: readonly ServicoParaItem[], intervaloMin: number): ItensMontados {
  const motivo = validarServicos(servicos.map((s) => s.servicoId));
  if (motivo !== null) return { ok: false, motivo };
  if (
    !Number.isFinite(inicio.getTime()) ||
    !Number.isSafeInteger(intervaloMin) ||
    intervaloMin < 0 ||
    servicos.some((s) => !Number.isSafeInteger(s.duracaoMin) || s.duracaoMin <= 0)
  ) {
    return { ok: false, motivo: 'duracao_invalida' };
  }
  let cursor = inicio.getTime();
  const itens: ItemDeReservaCriada[] = servicos.map((s, ordem) => {
    const ini = new Date(cursor);
    cursor += s.duracaoMin * MIN_MS;
    return {
      servicoId: s.servicoId,
      ordem,
      precoCentavos: s.precoCentavos,
      duracaoMin: s.duracaoMin,
      inicio: ini,
      fim: new Date(cursor),
    };
  });
  return { ok: true, itens, fim: new Date(cursor), ocupadoAte: new Date(cursor + intervaloMin * MIN_MS) };
}

/** Formato único de `criada` e `repetida` (A-12): sem nomes e sem dado da cliente. */
export function paraReservaCriada(dto: ReservaDTO): ReservaCriada {
  let cursor = dto.inicio.getTime();
  const itens = [...dto.itens]
    .sort((a, b) => a.ordem - b.ordem)
    .map((i) => {
      const inicio = new Date(cursor);
      cursor += i.duracaoMin * MIN_MS;
      return {
        servicoId: i.servicoId,
        ordem: i.ordem,
        precoCentavos: i.precoCentavos,
        duracaoMin: i.duracaoMin,
        inicio,
        fim: new Date(cursor),
      };
    });
  return {
    id: dto.id,
    profissionalId: dto.profissionalId,
    clienteId: dto.clienteId,
    inicio: dto.inicio,
    fim: dto.fim,
    ocupadoAte: dto.ocupadoAte,
    status: dto.status,
    origem: dto.origem,
    encaixe: dto.encaixe,
    revisao: dto.revisao,
    itens,
  };
}

/** RN-7: a reserva existente com a chave é o mesmo pedido (profissional, início e serviços na ordem). */
export function conferirCompativel(
  existente: ReservaDTO,
  pedido: { profissionalId: string; inicio: Date; servicoIds: readonly string[] },
): boolean {
  if (existente.profissionalId.toLowerCase() !== pedido.profissionalId.toLowerCase()) return false;
  if (existente.inicio.getTime() !== pedido.inicio.getTime()) return false;
  const itens = [...existente.itens].sort((a, b) => a.ordem - b.ordem).map((i) => i.servicoId);
  return (
    itens.length === pedido.servicoIds.length &&
    itens.every((id, i) => id.toLowerCase() === pedido.servicoIds[i].toLowerCase())
  );
}
