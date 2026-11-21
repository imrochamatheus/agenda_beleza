// Calendário do cálculo de disponibilidade (D-018 §3.1). Toda conversão de hora de parede passa por
// `@/server/tempo/fuso` (RN-9); aqui só há aritmética de datas civis (via Date.UTC) e a grade do dia.
import {
  type DataCivil,
  instanteDeHoraLocal,
  partesLocais,
  somarDias,
} from '@/server/tempo/fuso';

import type { RegrasDeAgenda } from './tipos';

const MS_MIN = 60_000;

/** 0 = domingo, o mesmo de `getUTCDay` sobre a data civil. */
export function diaDaSemana(d: DataCivil): 0 | 1 | 2 | 3 | 4 | 5 | 6 {
  return new Date(Date.UTC(d.ano, d.mes - 1, d.dia)).getUTCDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6;
}

/** Datas de `de` a `ate`, inclusive. `ate < de` lança RangeError. */
export function datasDoPeriodo(de: DataCivil, ate: DataCivil): DataCivil[] {
  const fim = Date.UTC(ate.ano, ate.mes - 1, ate.dia);
  if (fim < Date.UTC(de.ano, de.mes - 1, de.dia)) {
    throw new RangeError('A data final não pode ser anterior à inicial');
  }
  const datas: DataCivil[] = [];
  let atual = somarDias(de, 0);
  for (;;) {
    datas.push(atual);
    if (Date.UTC(atual.ano, atual.mes - 1, atual.dia) >= fim) break;
    atual = somarDias(atual, 1);
  }
  return datas;
}

/** `hoje` = data local de `agora`; `ultima` = hoje + janelaDias (inclusive, RN-5). */
export function limitesDaJanela(agora: Date, regras: RegrasDeAgenda): { hoje: DataCivil; ultima: DataCivil } {
  const hoje = partesLocais(agora, regras.fuso).data;
  return { hoje, ultima: somarDias(hoje, regras.janelaDias) };
}

/** A-7: de 00:00 local de `de` até 00:00 local de (`ate` + 1) + intervalo (cobre a RN-3c no último dia). */
export function periodoDeLeitura(de: DataCivil, ate: DataCivil, regras: RegrasDeAgenda): { de: Date; ate: Date } {
  const inicio = instanteDeHoraLocal(de, 0, regras.fuso);
  const fim = instanteDeHoraLocal(somarDias(ate, 1), 0, regras.fuso);
  return { de: inicio, ate: new Date(fim.getTime() + regras.intervaloMin * MS_MIN) };
}

export type CandidatoDaGrade = { readonly minutosDoDia: number; readonly instante: number };

/**
 * Grade do dia (RN-4, RN-10): para cada minuto de parede `m` múltiplo da grade, contado a partir de
 * 00:00 local, o instante `instanteDeHoraLocal(d, m)`. Descarta a hora inexistente (o rótulo local do
 * instante difere de `m`); na hora repetida vale só a primeira ocorrência. `minimoMin`/`maximoMin`
 * restringem a `[minimoMin, maximoMin)`. Instantes em ms, em ordem crescente.
 */
export function gradeDoDia(
  d: DataCivil,
  regras: RegrasDeAgenda,
  minimoMin = 0,
  maximoMin = 1440,
): CandidatoDaGrade[] {
  const g = regras.gradeMin;
  const grade: CandidatoDaGrade[] = [];
  for (let m = Math.ceil(Math.max(0, minimoMin) / g) * g; m < Math.min(1440, maximoMin); m += g) {
    const t = instanteDeHoraLocal(d, m, regras.fuso);
    const p = partesLocais(t, regras.fuso);
    if (p.minutosDoDia !== m || p.data.dia !== d.dia || p.data.mes !== d.mes || p.data.ano !== d.ano) continue;
    grade.push({ minutosDoDia: m, instante: t.getTime() });
  }
  return grade;
}
