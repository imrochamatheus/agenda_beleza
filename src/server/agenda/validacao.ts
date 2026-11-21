import { diferencaEmDias, ehDataCivilValida } from '@/server/tempo/fuso';
import type { DataCivil } from '@/server/tempo/fuso';

import { LIMITES_AGENDA, VISOES } from './tipos';
import type { Visao } from './tipos';

// Validação pura dos parâmetros de URL da agenda (D-028 RN-12): `data` e `visao` inválidos caem no
// padrão (hoje no fuso do salão, dia), nunca em erro. `profissional` só é normalizado aqui; quem decide
// se existe é o serviço (inválido ou estrangeiro → NaoEncontrado para o gestor).

export type ParametrosBrutos = { data?: unknown; visao?: unknown; profissional?: unknown };
export type ParametrosDaAgenda = { data: DataCivil; visao: Visao; profissional: string | null };

const DIAS_LIMITE = LIMITES_AGENDA.anos * 365 + 1;
const PADRAO_DATA = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isoDaData(d: DataCivil): string {
  return `${String(d.ano).padStart(4, '0')}-${String(d.mes).padStart(2, '0')}-${String(d.dia).padStart(2, '0')}`;
}

/** 'AAAA-MM-DD' → data civil válida; qualquer outra coisa → null. */
export function lerDataIso(v: unknown): DataCivil | null {
  const m = typeof v === 'string' ? PADRAO_DATA.exec(v) : null;
  if (m === null) return null;
  const d = { ano: Number(m[1]), mes: Number(m[2]), dia: Number(m[3]) };
  return ehDataCivilValida(d) ? d : null;
}

/** Data dentro de hoje ± 5 anos (1826 dias, por calendário). */
export function dentroDoLimite(d: DataCivil, hoje: DataCivil): boolean {
  return Math.abs(diferencaEmDias(hoje, d)) <= DIAS_LIMITE;
}

export function lerVisao(v: unknown): Visao {
  return typeof v === 'string' && (VISOES as readonly string[]).includes(v) ? (v as Visao) : 'dia';
}

export function lerParametros(b: ParametrosBrutos, hoje: DataCivil): ParametrosDaAgenda {
  const lida = lerDataIso(b.data);
  const data = lida !== null && dentroDoLimite(lida, hoje) ? lida : hoje;
  const profissional = typeof b.profissional === 'string' && b.profissional.trim() !== '' ? b.profissional.trim() : null;
  return { data, visao: lerVisao(b.visao), profissional };
}
