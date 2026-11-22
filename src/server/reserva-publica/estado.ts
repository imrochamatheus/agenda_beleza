// Leitura + decisão do estado de agendamento do salão (D-026 RN-5, D-038 §3.4). Sem next/*.
import { estadoEfetivoDoSalao } from '@/server/assinatura/estado-operacional';
import { listarServicosPublicos } from '@/server/repos/publico';
import type { PublicoContext } from '@/server/tenant/context';

import { agendamentoDisponivel } from './agendamento';
import type { DecisaoAgendamento } from './agendamento';

/** Estado efetivo (tabela única da D-037) + serviços ofertáveis → decisão da função pura única. */
export async function decidirAgendamento(ctx: PublicoContext, agora: Date): Promise<DecisaoAgendamento> {
  const [estado, servicos] = await Promise.all([estadoEfetivoDoSalao(ctx, agora), listarServicosPublicos(ctx)]);
  return agendamentoDisponivel({
    suspensoManual: estado.motivo === 'manual',
    agendar: estado.capacidades.agendar,
    servicosOfertaveis: servicos.length,
  });
}
