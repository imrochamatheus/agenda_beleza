import { intervaloDeDiasInteiros, somarDias } from '@/server/tempo/fuso';
import type { DataCivil } from '@/server/tempo/fuso';

import { isoDaData } from './validacao';
import type { DiaDaAgenda, Visao } from './tipos';

// Período exibido (RN-2): dia = [00:00, 24:00) local; semana = 7 dias a partir do domingo que contém a
// data. As fronteiras vêm de intervaloDeDiasInteiros (por calendário: dias de 23/25 h funcionam).

/** Dia da semana (0 = domingo) de uma data de calendário. */
export function diaDaSemana(d: DataCivil): number {
  return new Date(Date.UTC(d.ano, d.mes - 1, d.dia)).getUTCDay();
}

export type PeriodoDaAgenda = {
  dias: Pick<DiaDaAgenda, 'iso' | 'data' | 'diaSemana' | 'inicio' | 'fim'>[];
  de: Date;
  ate: Date;
  anterior: DataCivil;
  proximo: DataCivil;
};

export function montarPeriodo(data: DataCivil, visao: Visao, fuso: string): PeriodoDaAgenda {
  const primeiro = visao === 'semana' ? somarDias(data, -diaDaSemana(data)) : data;
  const quantos = visao === 'semana' ? 7 : 1;
  const dias = Array.from({ length: quantos }, (_, i) => {
    const d = somarDias(primeiro, i);
    const { inicio, fim } = intervaloDeDiasInteiros(d, d, fuso);
    return { iso: isoDaData(d), data: d, diaSemana: diaDaSemana(d), inicio, fim };
  });
  const passo = visao === 'semana' ? 7 : 1;
  return {
    dias,
    de: dias[0].inicio,
    ate: dias[dias.length - 1].fim,
    anterior: somarDias(data, -passo),
    proximo: somarDias(data, passo),
  };
}
