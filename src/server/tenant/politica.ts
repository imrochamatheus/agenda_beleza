import type { Capacidade, ContextoEscopado } from './context';

export type DecisaoPolitica = { permitido: true } | { permitido: false; motivo: string };

/**
 * Política de operação por capacidade, consultada por `defineAcao`, `criarReserva` e `alteracao-comum`
 * antes de qualquer escrita (D-038). Recebe o instante da execução (o mesmo de `resolverTenant`).
 * A implementação real vive em `src/server/assinatura/politica-operacao.ts` (não é importada aqui para
 * evitar ciclo); `permitirTudo` fica só para os testes do núcleo.
 */
export type PoliticaOperacao = (
  ctx: ContextoEscopado,
  capacidade: Capacidade,
  agora: Date,
) => DecisaoPolitica | Promise<DecisaoPolitica>;

export const permitirTudo: PoliticaOperacao = () => ({ permitido: true });
