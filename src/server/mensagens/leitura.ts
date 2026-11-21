import { repos, type Repos } from '@/server/repos';
import type { ContextoEscopado } from '@/server/tenant/context';

import type { MensagemDaReservaDTO } from './tipos';

/**
 * Situação de envio das mensagens de uma reserva, por `criado_em` (RN-23; contrato da E7.3). Sem
 * papel nem UI aqui. Nunca devolve destinatário, parâmetros nem id do provedor. Reserva de outro
 * salão ou id inválido → NaoEncontrado. `r` permite consultar dentro da transação do chamador.
 */
export async function mensagensDaReserva(
  ctx: ContextoEscopado,
  reservaId: string,
  r?: Repos,
): Promise<MensagemDaReservaDTO[]> {
  return (r ?? repos()).mensagens.listarDaReserva(ctx, reservaId);
}
