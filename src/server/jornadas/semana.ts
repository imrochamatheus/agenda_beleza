import type { JornadaLinhaDTO } from '@/server/repos/tipos';

import { DIAS_SEMANA } from './tipos';
import type { DiaSemana, IntervaloMin, SemanaJornada } from './tipos';

// Montagem da semana, pausas e diferença para a gravação (D-015 §3.3). Puro: sem banco nem imports
// de runtime de @/server/**.

type LinhaJornada = { diaSemana: number; inicioMin: number; fimMin: number };

/** Lacunas (> 0) entre intervalos consecutivos, na ordem de início. As pausas da RN-5. */
export function pausasDe(intervalos: readonly IntervaloMin[]): IntervaloMin[] {
  const ordenados = [...intervalos].sort((a, b) => a.inicioMin - b.inicioMin || a.fimMin - b.fimMin);
  const pausas: IntervaloMin[] = [];
  for (let i = 1; i < ordenados.length; i += 1) {
    const fimAnterior = ordenados[i - 1].fimMin;
    const inicio = ordenados[i].inicioMin;
    if (inicio > fimAnterior) pausas.push({ inicioMin: fimAnterior, fimMin: inicio });
  }
  return pausas;
}

/**
 * Sempre 7 dias (índice = diaSemana, 0 = domingo), intervalos ordenados por início e as pausas.
 * Linha com dia fora de 0..6 é erro de programação (o banco o impede com jornada_dia_semana_chk).
 */
export function montarSemana(linhas: readonly LinhaJornada[]): SemanaJornada {
  const porDia = new Map<DiaSemana, IntervaloMin[]>(DIAS_SEMANA.map((d) => [d, []]));
  for (const l of linhas) {
    const lista = porDia.get(l.diaSemana as DiaSemana);
    if (!lista) throw new RangeError(`montarSemana: dia da semana inválido (${String(l.diaSemana)})`);
    lista.push({ inicioMin: l.inicioMin, fimMin: l.fimMin });
  }
  return DIAS_SEMANA.map((diaSemana) => {
    const intervalos = porDia.get(diaSemana)!.sort((a, b) => a.inicioMin - b.inicioMin || a.fimMin - b.fimMin);
    return { diaSemana, intervalos, pausas: pausasDe(intervalos) };
  });
}

const chave = (l: LinhaJornada) => `${l.diaSemana}:${l.inicioMin}:${l.fimMin}`;

/**
 * Diferença por (dia, início, fim) (D-13): `remover` = ids existentes sem par em `desejados`;
 * `inserir` = desejados sem par em `existentes`. Igualdade total → nada a gravar (ids preservados).
 */
export function diferenca(
  existentes: readonly JornadaLinhaDTO[],
  desejados: readonly LinhaJornada[],
): { remover: string[]; inserir: LinhaJornada[] } {
  const desejadas = new Set(desejados.map(chave));
  const atuais = new Set(existentes.map(chave));
  return {
    remover: existentes.filter((l) => !desejadas.has(chave(l))).map((l) => l.id),
    inserir: desejados
      .filter((l) => !atuais.has(chave(l)))
      .map((l) => ({ diaSemana: l.diaSemana, inicioMin: l.inicioMin, fimMin: l.fimMin })),
  };
}
