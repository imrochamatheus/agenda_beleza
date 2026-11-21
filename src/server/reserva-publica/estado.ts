// Leitura + decisão do estado de agendamento do salão (D-026 RN-5). Sem next/*.
import { listarServicosPublicos, lerEstadoDeAgendamento } from '@/server/repos/publico';
import type { PublicoContext } from '@/server/tenant/context';

import { agendamentoDisponivel } from './agendamento';
import type { DecisaoAgendamento } from './agendamento';

/** Estado da assinatura/suspensão + serviços ofertáveis → decisão da função pura única. */
export async function decidirAgendamento(ctx: PublicoContext, agora: Date): Promise<DecisaoAgendamento> {
  const [estado, servicos] = await Promise.all([lerEstadoDeAgendamento(ctx), listarServicosPublicos(ctx)]);
  return agendamentoDisponivel({ ...estado, servicosOfertaveis: servicos.length, agora });
}
