import { repos } from '@/server/repos';
import type { ContextoEscopado } from '@/server/tenant/context';

import { montarSemana } from './semana';
import type { SemanaJornada } from './tipos';

/**
 * Jornada de um profissional para uso interno (D-015 §3.5; E3.1), SEM checagem de papel: aceita
 * TenantContext ou SistemaContext e filtra pelo salão do contexto. Profissional inexistente ou de
 * outro salão → semana vazia (quem chama confere o profissional).
 *
 * Obrigações de quem consome (E3.1):
 * - `diaSemana`: 0 = domingo … 6 = sábado (RN-15, como Date#getDay e EXTRACT(DOW)).
 * - Os minutos são hora LOCAL de parede no `salao.fuso` (RN-10), nunca UTC; a conversão em instantes,
 *   inclusive a hora inexistente ou repetida em fusos com horário de verão, é da E3.1.
 * - Forma canônica (RN-5): por dia, intervalos [início, fim) ordenados, sem sobreposição nem
 *   contiguidade; 0 ≤ início < fim ≤ 1440.
 */
export async function lerSemana(ctx: ContextoEscopado, profissionalId: string): Promise<SemanaJornada> {
  return montarSemana(await repos().jornadas.listarDoProfissional(ctx, profissionalId));
}
