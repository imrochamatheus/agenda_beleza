import { z } from 'zod';

import { FORMULARIO_INVALIDO, validarDias } from '@/server/semana/validacao';
import type { IntervaloDoDia } from '@/server/semana/validacao';

import type { ErrosJornada } from './tipos';

// Validação da jornada semanal (D-015 §3.3; RN-2..RN-7). D-020 (A-1): as regras dos 7 dias moram em
// src/server/semana/validacao.ts; aqui só a forma da entrada da jornada (`profissionalId` + `dias`).
// Mesmo comportamento para toda entrada (CA-19). A exclusion `jornada_sem_sobreposicao` continua
// sendo a garantia final.

export { converterHorario } from '@/server/semana/validacao';
export type { IntervaloDoDia } from '@/server/semana/validacao';

/** Forma da entrada (D-15): `profissionalId` texto e `dias` (validados pelo núcleo); extras recusados. */
const esquemaEntrada = z.strictObject({ profissionalId: z.string(), dias: z.unknown() });

/**
 * Valida a semana inteira (D-015 §3.3, regras 1..4). Todos os erros de campo voltam juntos; sem
 * erros, devolve os intervalos canônicos (RN-5) ordenados por (diaSemana, inicioMin). O
 * `profissionalId` não é validado como UUID aqui: o repositório responde 404 (CA-11).
 */
export function validarSemana(
  e: unknown,
): { ok: true; profissionalId: string; intervalos: IntervaloDoDia[] } | { ok: false; erros: ErrosJornada } {
  const entrada = esquemaEntrada.safeParse(e);
  if (!entrada.success) return FORMULARIO_INVALIDO;
  const r = validarDias(entrada.data.dias);
  if (!r.ok) return r;
  return { ok: true, profissionalId: entrada.data.profissionalId, intervalos: r.intervalos };
}
