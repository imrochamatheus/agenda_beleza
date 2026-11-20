import { repos } from '@/server/repos';
import type { Periodo } from '@/server/repos/tipos';
import type { ContextoEscopado } from '@/server/tenant/context';

/** Bloqueio para uso interno (sem o profissional, sem textos formatados). */
export type BloqueioLido = { id: string; profissionalId: string | null; inicio: Date; fim: Date; motivo: string | null };

/**
 * Bloqueios que intersectam [de, ate) (D-016 §3.6; E3.1, E3.3, E3.4), SEM checagem de papel: aceita
 * TenantContext ou SistemaContext e filtra pelo salão do contexto. `profissionalId` → os dele + os do
 * salão inteiro (profissional_id nulo vale para todos); sem → todos do salão. Ordem: inicio, id.
 *
 * Obrigações de quem consome:
 * - intersecção semiaberta: [b.inicio, b.fim) && [de, ate) (encostar não bloqueia);
 * - instantes em UTC; a conversão de hora de parede (jornada) em instantes é só por
 *   src/server/tempo/fuso.ts (instanteDeHoraLocal/partesLocais, regra RN-3 da D-016);
 * - `motivo` é só da equipe: nunca o exponha na página pública.
 */
export async function lerBloqueios(
  ctx: ContextoEscopado,
  periodo: Periodo,
  opcoes: { profissionalId?: string } = {},
): Promise<BloqueioLido[]> {
  const linhas = await repos().bloqueios.listarNoPeriodo(ctx, periodo, opcoes);
  return linhas.map((l) => ({ id: l.id, profissionalId: l.profissionalId, inicio: l.inicio, fim: l.fim, motivo: l.motivo }));
}
