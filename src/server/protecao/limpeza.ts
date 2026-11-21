// Limpeza das janelas expiradas (D-027 RN-8). O corte é `agora - (maior janela + 1 h)`: a maior janela é
// a de `PROTECAO_JANELA_SEGUNDOS` ou a das janelas próprias de login/recuperação/confirmação (15 min).
// Lotes de 1000 até esgotar; idempotente (reexecutar não apaga nada de novo).
import { removerExpiradas } from '@/server/repos/rate-limit';

import { configDaProtecao } from './config';

export const LOTE_LIMPEZA = 1000;
const JANELA_DAS_AUTENTICACOES_SEGUNDOS = 15 * 60;
const FOLGA_MS = 60 * 60 * 1000;

export function corteDaLimpeza(agora: Date, janelaProtecaoSegundos: number): Date {
  const maior = Math.max(janelaProtecaoSegundos, JANELA_DAS_AUTENTICACOES_SEGUNDOS) * 1000;
  return new Date(agora.getTime() - maior - FOLGA_MS);
}

export async function limparJanelasExpiradas(
  agora: Date,
  deps: { remover?: (corte: Date, lote: number) => Promise<number>; janelaSegundos?: number } = {},
): Promise<number> {
  const remover = deps.remover ?? removerExpiradas;
  const corte = corteDaLimpeza(agora, deps.janelaSegundos ?? configDaProtecao().janelaSegundos);
  let total = 0;
  for (;;) {
    const apagadas = await remover(corte, LOTE_LIMPEZA);
    total += apagadas;
    if (apagadas < LOTE_LIMPEZA) return total;
  }
}
