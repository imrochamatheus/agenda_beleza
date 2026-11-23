// Montagem pura dos itens da reserva (D-025 RN-1/RN-2; D-050 §3.5 passo 5, RN-4/RN-5). Cada item tem
// profissional e início próprios, sem encadeamento: `fim = inicio + duracao` (snapshot do serviço travado)
// e `ocupadoAte = fim + intervalo do salão`. Aritmética em milissegundos UTC, sem `Intl`.
import type { NovoItemDeReserva } from '@/server/repos/reserva';
import type { ReservaDTO } from '@/server/repos/tipos';

import type { ItemDeReservaCriada, ItemPedido, ReservaCriada } from './tipos';

const MIN_MS = 60_000;

export type ServicoParaItem = { precoCentavos: number; duracaoMin: number };

/**
 * Um `NovoItemDeReserva` por item pedido, na ordem pedida (`ordem` = posição), com o snapshot de preço e
 * duração do serviço de cada item (`servicos`, por id em minúsculas) e `encaixe = false`. Duração não
 * inteira positiva, intervalo negativo ou serviço ausente do mapa → RangeError (erro de programação: o
 * chamador só monta depois de travar e conferir os serviços).
 */
export function montarItens(
  pedidos: readonly ItemPedido[],
  servicos: ReadonlyMap<string, ServicoParaItem>,
  intervaloMin: number,
): NovoItemDeReserva[] {
  if (!Number.isSafeInteger(intervaloMin) || intervaloMin < 0) throw new RangeError('montarItens: intervalo inválido');
  return pedidos.map((p, ordem) => {
    const s = servicos.get(p.servicoId.toLowerCase());
    if (s === undefined) throw new RangeError('montarItens: serviço sem snapshot');
    if (!Number.isSafeInteger(s.duracaoMin) || s.duracaoMin <= 0) throw new RangeError('montarItens: duração inválida');
    const inicio = p.inicio.getTime();
    if (!Number.isFinite(inicio)) throw new RangeError('montarItens: início inválido');
    const fim = inicio + s.duracaoMin * MIN_MS;
    return {
      servicoId: p.servicoId.toLowerCase(),
      profissionalId: p.profissionalId.toLowerCase(),
      ordem,
      inicio: new Date(inicio),
      fim: new Date(fim),
      ocupadoAte: new Date(fim + intervaloMin * MIN_MS),
      precoCentavos: s.precoCentavos,
      duracaoMin: s.duracaoMin,
      encaixe: false,
    };
  });
}

/** Ordem de exibição (RN-6): por início, depois id. */
function porInicioEId(a: { inicio: Date; id: string }, b: { inicio: Date; id: string }): number {
  return a.inicio.getTime() - b.inicio.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Itens recém-gravados (com os ids de `criarItens`, casados por `ordem`) no formato de `ReservaCriada`. */
export function itensCriados(itens: readonly NovoItemDeReserva[], ids: readonly { id: string; ordem: number }[]): ItemDeReservaCriada[] {
  const porOrdem = new Map(ids.map((x) => [x.ordem, x.id]));
  return itens
    .map((i) => {
      const id = porOrdem.get(i.ordem);
      if (id === undefined) throw new Error('criarItens não devolveu o id de um item');
      return { id, ...i, status: 'confirmado' as const };
    })
    .sort(porInicioEId);
}

/** Formato único de `criada` e `repetida` (A-12): sem nomes e sem dado da cliente; itens por (inicio, id). */
export function paraReservaCriada(dto: ReservaDTO): ReservaCriada {
  return {
    id: dto.id,
    clienteId: dto.clienteId,
    inicio: dto.inicio,
    fim: dto.fim,
    status: dto.status,
    origem: dto.origem,
    revisao: dto.revisao,
    itens: dto.itens
      .map((i) => ({
        id: i.id,
        servicoId: i.servicoId,
        profissionalId: i.profissionalId,
        ordem: i.ordem,
        inicio: i.inicio,
        fim: i.fim,
        ocupadoAte: i.ocupadoAte,
        precoCentavos: i.precoCentavos,
        duracaoMin: i.duracaoMin,
        encaixe: i.encaixe,
        status: i.status,
      }))
      .sort(porInicioEId),
  };
}

/**
 * RN-14 (D-025 RN-7): a reserva existente com a chave é o mesmo pedido quando o CONJUNTO
 * {servicoId, profissionalId, inicio} dos itens é igual (a ordem de escolha não importa; ids sem caixa).
 */
export function conferirCompativel(existente: ReservaDTO, pedido: readonly ItemPedido[]): boolean {
  const chave = (i: { servicoId: string; profissionalId: string; inicio: Date }) =>
    `${i.servicoId.toLowerCase()}|${i.profissionalId.toLowerCase()}|${i.inicio.getTime()}`;
  const a = existente.itens.map(chave).sort();
  const b = pedido.map(chave).sort();
  return a.length === b.length && a.every((x, k) => x === b[k]);
}
