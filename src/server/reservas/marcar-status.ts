// Marcar o resultado do atendimento (D-030 RN-8/RN-9): `concluido` e `nao_compareceu`.
// `confirmado → concluido` registra o convite de avaliação (revisão 0, outbox); `concluido → nao_compareceu`
// substitui só o convite ainda `pendente`; a volta a `concluido` não reenvia (chave única).
//
// GANCHO DA E4.5 (sem schema agora): o link de avaliação só vale com `reserva.status = 'concluido'`
// (`conferirVigencia` já fecha o convite quando o status muda) e as listagens/médias de avaliações devem
// filtrar por `reserva.status = 'concluido'`; ao voltar a `concluido` a avaliação reaparece.
import type { TenantContext } from '@/server/tenant/context';

import { alterarStatus } from './alterar-status';
import type { DependenciasAlteracao, EntradaMarcarStatus, ResultadoStatus } from './tipos-alteracao';

export function marcarStatusReserva(
  ctx: TenantContext,
  e: EntradaMarcarStatus,
  agora: Date,
  deps: DependenciasAlteracao = {},
): Promise<ResultadoStatus> {
  return alterarStatus(
    ctx,
    { reservaId: e.reservaId, destino: e.para, permitidos: ['concluido', 'nao_compareceu'], operacao: 'marcar_status' },
    agora,
    deps,
  );
}
