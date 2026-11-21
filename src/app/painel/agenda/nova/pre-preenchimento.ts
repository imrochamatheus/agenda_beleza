// Pré-preenchimento da reserva manual por query (D-029 RN-1): `profissional`, `data` e `hora`. Puro, sem
// next/*. Valor repetido (array), malformado ou fora das opções vale como ausente (sem erro nem 404).
import { lerData, lerHora } from '@/server/reservas/reserva-equipe';
import { ehUuid } from '@/server/repos/ids';
import type { DataCivil } from '@/server/tempo/fuso';

import { valoresVazios } from './estado';
import type { ValoresReservaManual } from './estado';

export type ParametrosBrutos = Record<string, string | string[] | undefined>;

const um = (v: string | string[] | undefined): string | undefined => (typeof v === 'string' ? v : undefined);
const dois = (n: number): string => String(n).padStart(2, '0');

export function dataIso(d: DataCivil): string {
  return `${String(d.ano).padStart(4, '0')}-${dois(d.mes)}-${dois(d.dia)}`;
}

export function horaTexto(minutos: number): string {
  return `${dois(Math.floor(minutos / 60))}:${dois(minutos % 60)}`;
}

/**
 * `profissionaisValidos`: ids do salão que a pessoa pode escolher (gestor: todos os ativos; profissional:
 * só o próprio). `fixo`: id imposto (profissional). `hoje`: data civil local do salão.
 */
export function valoresIniciais(
  params: ParametrosBrutos,
  o: { profissionaisValidos: readonly string[]; fixo: string | null; hoje: DataCivil },
): ValoresReservaManual {
  const pedido = um(params.profissional)?.toLowerCase();
  const profissionalId = o.fixo ?? (pedido !== undefined && ehUuid(pedido) && o.profissionaisValidos.includes(pedido) ? pedido : '');
  const data = lerData(um(params.data));
  const hora = lerHora(um(params.hora));
  return valoresVazios({
    profissionalId,
    data: dataIso(data ?? o.hoje),
    hora: hora === null ? '' : horaTexto(hora),
  });
}
