// Decisão de encaixe da equipe em LOTE (D-029 RN-2/RN-3; D-050 A-11, RN-17). Sem 'use server' e sem
// next/*. Lê NA transação, com o `r` dela (sob as travas dos profissionais), exatamente 3 instruções
// qualquer que seja o número de itens: jornadas dos profissionais dos itens, bloqueios (próprios e do
// salão inteiro) que cruzam o período dos itens e o funcionamento do salão. A detecção por item é a
// função pura `detectarMotivos` (encaixe.ts). Usada pela criação (T-12, via `criarReserva`) e pela
// remarcação de item (T-6, lote de 1).
import { montarSemana } from '@/server/semana/montagem';

import { detectarMotivos } from './encaixe';
import type { DependenciasCriarReserva, MotivosDoItem } from './tipos';

export type DecisorDeEncaixe = NonNullable<DependenciasCriarReserva['decidirEncaixe']>;

/**
 * `confirmou` = a equipe marcou "Confirmo o encaixe" (uma confirmação vale para todos os itens, RN-17).
 * Sem motivo em nenhum item → `encaixes` todos false. Com motivo e confirmado → `encaixes[k]` true só nos
 * itens com motivo (flag real, D-029). Com motivo e sem confirmação → `motivos` dos itens que os têm.
 * Lista de itens vazia → RangeError (erro de programação).
 */
export function criarDecisorDeEncaixe(confirmou: boolean): DecisorDeEncaixe {
  return async (ctx, r, { fuso, itens }) => {
    if (itens.length === 0) throw new RangeError('decidirEncaixe: lote vazio');
    const profissionais = [...new Set(itens.map((i) => i.profissionalId.toLowerCase()))];
    const de = new Date(Math.min(...itens.map((i) => i.inicio.getTime())));
    const ate = new Date(Math.max(...itens.map((i) => i.fim.getTime())));

    const jornadas = await r.disponibilidade.jornadas(ctx, profissionais);
    const bloqueios = await r.disponibilidade.bloqueios(ctx, profissionais, { de, ate });
    const dto = await r.funcionamento.ler(ctx);
    const funcionamento = dto.definido ? { definido: true as const, semana: montarSemana(dto.linhas) } : { definido: false as const };

    const porItem: MotivosDoItem[] = itens.map((item, indice) => {
      const pid = item.profissionalId.toLowerCase();
      const jornada = montarSemana(jornadas.filter((j) => j.profissionalId.toLowerCase() === pid));
      const doItem = bloqueios.filter((b) => b.profissionalId === null || b.profissionalId.toLowerCase() === pid);
      return { indice, motivos: detectarMotivos({ inicio: item.inicio, fim: item.fim, fuso, jornada, bloqueios: doItem, funcionamento }) };
    });
    const comMotivo = porItem.filter((x) => x.motivos.length > 0);
    if (comMotivo.length > 0 && !confirmou) return { motivos: comMotivo };
    return { encaixes: porItem.map((x) => x.motivos.length > 0) };
  };
}
