// Marcar o resultado do atendimento de UM item (D-030 RN-8/RN-9; D-050 RN-20/RN-33): `concluido` e
// `nao_compareceu`. Não sobe a revisão nem gera mensagem do item. O convite de avaliação nasce quando o status
// DERIVADO da reserva passa a `concluido` (último item `confirmado` resolvido com ao menos um concluído, ou
// `nao_compareceu → concluido` sem outro concluído); quando ele deixa de ser `concluido`, o convite ainda
// `pendente` é substituído (vigência). A volta a `concluido` não reenvia (chave única).
import type { TenantContext } from '@/server/tenant/context';

import { alterarStatusDoItem } from './alterar-status';
import type { DependenciasAlteracao, EntradaMarcarStatusItem, ResultadoStatusItem } from './tipos-alteracao';

export function marcarStatusDoItem(
  ctx: TenantContext,
  e: EntradaMarcarStatusItem,
  agora: Date,
  deps: DependenciasAlteracao = {},
): Promise<ResultadoStatusItem> {
  return alterarStatusDoItem(
    ctx,
    { reservaId: e.reservaId, itemId: e.itemId, destino: e.destino, permitidos: ['concluido', 'nao_compareceu'], operacao: 'marcar_status_item' },
    agora,
    deps,
  );
}
