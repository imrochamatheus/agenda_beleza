import type { Funcionamento } from '@/server/salao/funcionamento-tipos';
import type { IntervaloMin, SemanaHoraria } from '@/server/semana/tipos';
import { partesLocais } from '@/server/tempo/fuso';

import type { FaixaDoDia } from './tipos';

// Faixas de fundo e posicionamento (D-028 RN-9, CA-7, CA-8, CA-13). Puro: minutos de parede do dia local.

const DIA_MIN = 1440;

/** Complemento de intervalos canônicos (ordenados, sem sobreposição) em [0, 1440). */
export function complemento(intervalos: readonly IntervaloMin[]): FaixaDoDia[] {
  const saida: FaixaDoDia[] = [];
  let cursor = 0;
  for (const { inicioMin, fimMin } of [...intervalos].sort((a, b) => a.inicioMin - b.inicioMin)) {
    if (inicioMin > cursor) saida.push({ inicioMin: cursor, fimMin: inicioMin });
    cursor = Math.max(cursor, fimMin);
  }
  if (cursor < DIA_MIN) saida.push({ inicioMin: cursor, fimMin: DIA_MIN });
  return saida;
}

/** a − b (ambos listas de intervalos ordenados). */
export function subtrair(a: readonly FaixaDoDia[], b: readonly FaixaDoDia[]): FaixaDoDia[] {
  let atual = a.map((f) => ({ ...f }));
  for (const cortar of b) {
    atual = atual.flatMap((f) => {
      if (cortar.fimMin <= f.inicioMin || cortar.inicioMin >= f.fimMin) return [f];
      const partes: FaixaDoDia[] = [];
      if (cortar.inicioMin > f.inicioMin) partes.push({ inicioMin: f.inicioMin, fimMin: cortar.inicioMin });
      if (cortar.fimMin < f.fimMin) partes.push({ inicioMin: cortar.fimMin, fimMin: f.fimMin });
      return partes;
    });
  }
  return atual;
}

/** Fechado pelo funcionamento: `definido: false` não pinta nada; dia sem intervalos = dia inteiro. */
export function foraDoFuncionamento(f: Funcionamento, diaSemana: number): FaixaDoDia[] {
  if (!f.definido) return [];
  return complemento(f.semana[diaSemana]?.intervalos ?? []);
}

/** Fora da jornada do profissional, sem o que o salão já marca como fechado (distinto, CA-8). */
export function foraDaJornada(
  jornada: SemanaHoraria | null,
  diaSemana: number,
  fechado: readonly FaixaDoDia[],
): FaixaDoDia[] {
  const intervalos = jornada?.[diaSemana]?.intervalos ?? [];
  return subtrair(complemento(intervalos), fechado);
}

export const diaInteiroFechado = (faixas: readonly FaixaDoDia[]): boolean =>
  faixas.length === 1 && faixas[0].inicioMin === 0 && faixas[0].fimMin === DIA_MIN;

/**
 * Recorte de [inicio, fim) ao dia [diaInicio, diaFim) em minutos de parede (reserva que cruza a
 * meia-noite aparece nos dois dias, CA-13). null se não cruza o dia.
 */
export function recortarNoDia(
  inicio: Date,
  fim: Date,
  dia: { inicio: Date; fim: Date },
  fuso: string,
): FaixaDoDia | null {
  if (!(inicio < dia.fim && fim > dia.inicio)) return null;
  const i = inicio <= dia.inicio ? 0 : partesLocais(inicio, fuso).minutosDoDia;
  const f = fim >= dia.fim ? DIA_MIN : partesLocais(fim, fuso).minutosDoDia;
  if (f > i) return { inicioMin: i, fimMin: f };
  // Hora de parede repetida (recuo do horário de verão) ou duração menor que 1 minuto: o fim não vem
  // depois do início em hora de parede; usa a duração real (no mínimo 1 minuto), limitada ao dia.
  const real = (Math.min(fim.getTime(), dia.fim.getTime()) - Math.max(inicio.getTime(), dia.inicio.getTime())) / 60_000;
  return { inicioMin: i, fimMin: Math.min(DIA_MIN, i + Math.max(1, Math.round(real))) };
}

export type ComPosicao<T> = T & { coluna: number; colunas: number };

/**
 * Lado a lado (encaixes sobrepostos não se escondem): agrupa itens que se sobrepõem em cadeia e
 * reparte cada grupo em colunas, pela ordem de início.
 */
export function distribuirLadoALado<T extends FaixaDoDia>(itens: readonly T[]): ComPosicao<T>[] {
  const ordenados = [...itens].sort((a, b) => a.inicioMin - b.inicioMin || a.fimMin - b.fimMin);
  const saida: ComPosicao<T>[] = [];
  let grupo: { item: T; coluna: number }[] = [];
  let fimDoGrupo = -1;
  let fimPorColuna: number[] = [];
  const fechar = () => {
    for (const g of grupo) saida.push({ ...g.item, coluna: g.coluna, colunas: fimPorColuna.length });
    grupo = [];
    fimPorColuna = [];
  };
  for (const item of ordenados) {
    if (grupo.length > 0 && item.inicioMin >= fimDoGrupo) fechar();
    let coluna = fimPorColuna.findIndex((fim) => fim <= item.inicioMin);
    if (coluna === -1) coluna = fimPorColuna.length;
    fimPorColuna[coluna] = item.fimMin;
    fimDoGrupo = grupo.length === 0 ? item.fimMin : Math.max(fimDoGrupo, item.fimMin);
    grupo.push({ item, coluna });
  }
  fechar();
  return saida;
}
