// Detecção pura dos motivos de encaixe (D-029 RN-2): sem banco, sem next/*, sem relógio. A conversão de
// instante em hora de parede é só por src/server/tempo/fuso.ts. Os minutos de jornada e funcionamento são
// hora LOCAL de parede do salão (0..1440); atravessar a meia-noite local = fora (nenhum intervalo cruza dia).
import type { Funcionamento } from '@/server/salao/funcionamento-tipos';
import type { SemanaHoraria } from '@/server/semana/tipos';
import { compararDatas, partesLocais, somarDias } from '@/server/tempo/fuso';
import type { DataCivil } from '@/server/tempo/fuso';

import type { MotivoEncaixe } from './tipos';

export type EntradaDetectarMotivos = {
  inicio: Date;
  fim: Date;
  fuso: string;
  /** Jornada do profissional (7 dias, índice = diaSemana). */
  jornada: SemanaHoraria;
  /** Bloqueios próprios e do salão inteiro que podem cruzar o período. */
  bloqueios: readonly { inicio: Date; fim: Date }[];
  funcionamento: Funcionamento;
};

/** Dia da semana (0 = domingo) de uma data civil. */
function diaDaSemana(d: DataCivil): number {
  return new Date(Date.UTC(d.ano, d.mes - 1, d.dia)).getUTCDay();
}

/** [início, fim) em minutos do dia local de `inicio`; fim = 1440 só quando termina à 00:00 do dia seguinte; null = cruza o dia. */
function faixaLocal(inicio: Date, fim: Date, fuso: string): { dia: number; ini: number; fim: number } | null {
  const a = partesLocais(inicio, fuso);
  const b = partesLocais(fim, fuso);
  const mesmoDia = compararDatas(a.data, b.data) === 0;
  const meiaNoiteSeguinte = compararDatas(somarDias(a.data, 1), b.data) === 0 && b.minutosDoDia === 0;
  if (!mesmoDia && !meiaNoiteSeguinte) return null;
  return { dia: diaDaSemana(a.data), ini: a.minutosDoDia, fim: mesmoDia ? b.minutosDoDia : 1440 };
}

function cabeEmUm(semana: SemanaHoraria, faixa: { dia: number; ini: number; fim: number }): boolean {
  const dia = semana.find((d) => d.diaSemana === faixa.dia);
  return dia?.intervalos.some((i) => i.inicioMin <= faixa.ini && faixa.fim <= i.fimMin) ?? false;
}

/** Motivos na ordem fixa fora_da_jornada, bloqueado, fora_do_funcionamento; vazio = horário normal. */
export function detectarMotivos(e: EntradaDetectarMotivos): MotivoEncaixe[] {
  const motivos: MotivoEncaixe[] = [];
  const faixa = faixaLocal(e.inicio, e.fim, e.fuso);
  if (faixa === null || !cabeEmUm(e.jornada, faixa)) motivos.push('fora_da_jornada');
  const ini = e.inicio.getTime();
  const fim = e.fim.getTime();
  if (e.bloqueios.some((b) => b.inicio.getTime() < fim && ini < b.fim.getTime())) motivos.push('bloqueado');
  if (e.funcionamento.definido && (faixa === null || !cabeEmUm(e.funcionamento.semana, faixa))) {
    motivos.push('fora_do_funcionamento');
  }
  return motivos;
}
