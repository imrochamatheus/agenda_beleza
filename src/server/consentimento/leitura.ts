import type { Finalidade } from '@/config/termos';
import { repos, type Repos } from '@/server/repos';
import type { ContextoEscopado } from '@/server/tenant/context';

import type { ConsentimentoVisao } from './tipos';

/**
 * Consentimento vigente (RN-14): a linha mais recente da (cliente, finalidade) ou null (sem linha ou
 * cliente anonimizada). Cliente que não é do salão → NaoEncontrado. Sem verificação de papel (uso
 * interno de E3.4/E3.5/E7.1); `r` permite consultar dentro da transação do chamador. Devolve a
 * versão ACEITA, nunca a comparada com a atual (A-13).
 */
export async function consentimentoVigente(
  ctx: ContextoEscopado,
  clienteId: string,
  finalidade: Finalidade,
  r?: Repos,
): Promise<ConsentimentoVisao | null> {
  return (r ?? repos()).consentimentos.vigente(ctx, clienteId, finalidade);
}

/** RN-8: há consentimento vigente de mensagens da reserva, de qualquer origem. */
export async function temConsentimentoDeMensagens(ctx: ContextoEscopado, clienteId: string, r?: Repos): Promise<boolean> {
  return (await consentimentoVigente(ctx, clienteId, 'mensagens_reserva', r)) !== null;
}
