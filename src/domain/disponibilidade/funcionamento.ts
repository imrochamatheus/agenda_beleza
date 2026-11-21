// Interseção jornada ∩ funcionamento em minutos de parede (D-018 A-10..A-12, RN-20..RN-22). Não faz
// aritmética de fuso: os limites só viram instantes depois, por `@/server/tempo/fuso` (RN-9).
import type { FuncionamentoDeAgenda, IntervaloMin } from './tipos';

export type { FuncionamentoDeAgenda };

function validarIntervalo(x: IntervaloMin): void {
  if (
    !Number.isInteger(x.inicioMin) ||
    !Number.isInteger(x.fimMin) ||
    x.inicioMin < 0 ||
    x.inicioMin >= x.fimMin ||
    x.fimMin > 1440
  ) {
    throw new RangeError(`Intervalo de funcionamento inválido: ${JSON.stringify(x)}`);
  }
}

/** Forma inválida (sete dias; cada intervalo 0 <= ini < fim <= 1440, inteiros) → RangeError (A-12). */
export function validarFuncionamento(f: FuncionamentoDeAgenda): void {
  if (f === null || typeof f !== 'object' || typeof f.definido !== 'boolean') {
    throw new RangeError('Funcionamento inválido');
  }
  if (!f.definido) return;
  if (!Array.isArray(f.dias) || f.dias.length !== 7) {
    throw new RangeError('O funcionamento deve ter sete dias');
  }
  for (const dia of f.dias) {
    if (!Array.isArray(dia)) throw new RangeError('Dia de funcionamento inválido');
    for (const x of dia) validarIntervalo(x);
  }
}

/**
 * Jornada ∩ funcionamento do dia, em minutos. `funcionamentoDoDia === null` (não informado) devolve a
 * jornada. Entradas canônicas (ordenadas, sem sobreposição); varredura de dois ponteiros, O(a+b).
 * Saída ordenada e disjunta, sem vazios. Dia fechado (`[]`) → `[]`.
 */
export function janelasDoDia(
  jornadaDoDia: readonly IntervaloMin[],
  funcionamentoDoDia: readonly IntervaloMin[] | null,
): IntervaloMin[] {
  if (funcionamentoDoDia === null) return jornadaDoDia.map((x) => ({ inicioMin: x.inicioMin, fimMin: x.fimMin }));
  const saida: IntervaloMin[] = [];
  let a = 0;
  let b = 0;
  while (a < jornadaDoDia.length && b < funcionamentoDoDia.length) {
    const j = jornadaDoDia[a];
    const f = funcionamentoDoDia[b];
    const inicioMin = Math.max(j.inicioMin, f.inicioMin);
    const fimMin = Math.min(j.fimMin, f.fimMin);
    if (inicioMin < fimMin) saida.push({ inicioMin, fimMin });
    if (j.fimMin < f.fimMin) a += 1;
    else b += 1;
  }
  return saida;
}
