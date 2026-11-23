// Cancelar UM item (D-030 RN-6; D-050 RN-20/RN-28/RN-29): `confirmado → cancelado` só com `agora < item.fim`;
// sobe `reserva.revisao` em 1, grava essa revisão no item e registra `cancelamento` com `reservaItemId`
// (chave `reserva:cancelamento:<revisao>`) na mesma transação. Os outros itens não mudam (RN-23); o status
// derivado só vira `cancelado` quando o último item não cancelado é cancelado.
import type { TenantContext } from '@/server/tenant/context';

import { alterarStatusDoItem } from './alterar-status';
import type { DependenciasAlteracao, EntradaItem, ResultadoStatusItem } from './tipos-alteracao';

export function cancelarItem(ctx: TenantContext, e: EntradaItem, agora: Date, deps: DependenciasAlteracao = {}): Promise<ResultadoStatusItem> {
  return alterarStatusDoItem(
    ctx,
    { reservaId: e.reservaId, itemId: e.itemId, destino: 'cancelado', permitidos: ['cancelado'], operacao: 'cancelar_item' },
    agora,
    deps,
  );
}
