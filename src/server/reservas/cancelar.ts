// Cancelar reserva (D-030 RN-6): `confirmado → cancelado` só com `agora < fim`; grava `cancelada_em`, NÃO
// incrementa `revisao` e registra `cancelamento` (chave `reserva:cancelamento:<revisao>`) na mesma transação.
import type { TenantContext } from '@/server/tenant/context';

import { alterarStatus } from './alterar-status';
import type { DependenciasAlteracao, EntradaCancelar, ResultadoStatus } from './tipos-alteracao';

export function cancelarReserva(ctx: TenantContext, e: EntradaCancelar, agora: Date, deps: DependenciasAlteracao = {}): Promise<ResultadoStatus> {
  return alterarStatus(ctx, { reservaId: e.reservaId, destino: 'cancelado', permitidos: ['cancelado'], operacao: 'cancelar' }, agora, deps);
}
