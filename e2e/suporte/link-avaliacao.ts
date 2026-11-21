// Link do convite de avaliação sem worker (D-036 RN-14): o mesmo gerador que o worker injeta, com o segredo
// público do E2E, contra a base `_e2e`. Cria o convite (idempotente) e devolve o caminho `/slug/avaliar/token`.
import { criarGeradorLink } from '@/server/avaliacoes/convite';
import { contextoDeSistema } from '@/server/tenant/context';

import { APP_URL_E2E, SEGREDO_E2E, urlDoBancoE2E } from './ambiente';

export async function linkDeAvaliacao(salaoId: string, reservaId: string): Promise<string> {
  // O repositório lê DATABASE_URL na chamada: aponta para a base do E2E neste processo de teste.
  process.env.DATABASE_URL = urlDoBancoE2E(process.env);
  const gerar = criarGeradorLink({ segredo: () => SEGREDO_E2E, appUrl: () => APP_URL_E2E });
  const url = await gerar(contextoDeSistema(salaoId, 'e2e'), reservaId);
  return new URL(url).pathname;
}
