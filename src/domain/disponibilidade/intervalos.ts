// Normalização e busca de intervalos (D-018 §3.1, passo 2). Tudo em milissegundos (ou minutos), sem
// métodos de data.
import type { Intervalo, IntervaloMin } from './tipos';

/** Semiaberto [i, f) em ms. */
export type ParMs = { readonly i: number; readonly f: number };

/**
 * Copia, ordena por (início, fim) e une os que se sobrepõem ou encostam. Intervalos vazios ou
 * invertidos são descartados. Para a busca de interseção a união é equivalente (CA-24: a ordem da
 * entrada é irrelevante).
 */
export function unirIntervalos(entrada: readonly Intervalo[]): ParMs[] {
  const pares = entrada
    .map((x) => ({ i: x.inicio.getTime(), f: x.fim.getTime() }))
    .filter((p) => p.f > p.i)
    .sort((a, b) => a.i - b.i || a.f - b.f);
  const uniao: { i: number; f: number }[] = [];
  for (const p of pares) {
    const ultimo = uniao[uniao.length - 1];
    if (ultimo !== undefined && p.i <= ultimo.f) {
      if (p.f > ultimo.f) ultimo.f = p.f;
    } else {
      uniao.push({ i: p.i, f: p.f });
    }
  }
  return uniao;
}

/** Une em minutos de parede (mesma regra, para jornada e funcionamento já canônicos ou não). */
export function unirMinutos(entrada: readonly IntervaloMin[]): IntervaloMin[] {
  const ordenado = entrada
    .filter((x) => x.fimMin > x.inicioMin)
    .map((x) => ({ inicioMin: x.inicioMin, fimMin: x.fimMin }))
    .sort((a, b) => a.inicioMin - b.inicioMin || a.fimMin - b.fimMin);
  const uniao: { inicioMin: number; fimMin: number }[] = [];
  for (const x of ordenado) {
    const ultimo = uniao[uniao.length - 1];
    if (ultimo !== undefined && x.inicioMin <= ultimo.fimMin) {
      if (x.fimMin > ultimo.fimMin) ultimo.fimMin = x.fimMin;
    } else {
      uniao.push(x);
    }
  }
  return uniao;
}

/**
 * true se [a, b) intersecta algum intervalo da união (ordenada e disjunta). Busca binária pelo último
 * intervalo com início < b e verificação de que seu fim > a (encostar não intersecta).
 */
export function intersecta(uniao: readonly ParMs[], a: number, b: number): boolean {
  let lo = 0;
  let hi = uniao.length - 1;
  let achado = -1;
  while (lo <= hi) {
    const meio = (lo + hi) >> 1;
    if (uniao[meio].i < b) {
      achado = meio;
      lo = meio + 1;
    } else {
      hi = meio - 1;
    }
  }
  return achado >= 0 && uniao[achado].f > a;
}
