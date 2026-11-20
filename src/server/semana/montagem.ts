import { DIAS_SEMANA } from './tipos';
import type { DiaSemana, IntervaloMin, SemanaHoraria } from './tipos';

// Montagem da semana, pausas e diferença para a gravação (D-020 §3.1, extraído da jornada D-015).
// Puro: sem banco nem imports de runtime de @/server/** fora desta pasta.

type LinhaSemana = { diaSemana: number; inicioMin: number; fimMin: number };

/** Lacunas (> 0) entre intervalos consecutivos, na ordem de início. */
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
 * Linha com dia fora de 0..6 é erro de programação (o banco o impede com os CHECKs de dia).
 */
export function montarSemana(linhas: readonly LinhaSemana[]): SemanaHoraria {
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

const chave = (l: LinhaSemana) => `${l.diaSemana}:${l.inicioMin}:${l.fimMin}`;

/**
 * Diferença por (dia, início, fim): `remover` = ids existentes sem par em `desejados`;
 * `inserir` = desejados sem par em `existentes`. Igualdade total → nada a gravar (ids preservados).
 */
export function diferenca(
  existentes: readonly (LinhaSemana & { id: string })[],
  desejados: readonly LinhaSemana[],
): { remover: string[]; inserir: LinhaSemana[] } {
  const desejadas = new Set(desejados.map(chave));
  const atuais = new Set(existentes.map(chave));
  return {
    remover: existentes.filter((l) => !desejadas.has(chave(l))).map((l) => l.id),
    inserir: desejados
      .filter((l) => !atuais.has(chave(l)))
      .map((l) => ({ diaSemana: l.diaSemana, inicioMin: l.inicioMin, fimMin: l.fimMin })),
  };
}
