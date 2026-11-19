import type { Capacidade, TenantContext } from './context';

export type DecisaoPolitica = { permitido: true } | { permitido: false; motivo: string };

/**
 * Política de operação por capacidade, consultada por `defineAcao` antes do handler (RN-7).
 * A E6.4 implementa a regra real por estado da assinatura (S13 de D-001/design.md §5).
 */
export type PoliticaOperacao = (
  ctx: TenantContext,
  capacidade: Capacidade,
) => DecisaoPolitica | Promise<DecisaoPolitica>;

export const permitirTudo: PoliticaOperacao = () => ({ permitido: true });

/** Política em vigor. A E6.4 troca esta linha pela política real. */
export const politicaDeOperacao: PoliticaOperacao = permitirTudo;
