import { ESTADOS_ASSINATURA, decidirEstadoEfetivo } from '@/domain/assinatura';
import type { EstadoAssinatura } from '@/domain/assinatura';
import { repos } from '@/server/repos';
import type { ContextoEscopado } from '@/server/tenant/context';

import { LIMITE_PAGAMENTOS, acoesDoEstado } from './tela-tipos';
import type { DatasDaTela, TelaAssinatura } from './tela-tipos';

// Leitura da tela /painel/assinatura (D-042 §3.4): um instantâneo do salão + assinatura mais recente
// (`lerDetalhe`), o MESMO `decidirEstadoEfetivo` da política operacional sobre ele, e os pagamentos.
// Só leitura, escopada pelo `salaoId` do contexto; o vínculo com o provedor não sai daqui.

export async function lerTelaAssinatura(ctx: ContextoEscopado, agora: Date): Promise<TelaAssinatura> {
  const r = repos().assinaturas;
  const [d, pagos] = await Promise.all([r.lerDetalhe(ctx), r.listarPagamentos(ctx, LIMITE_PAGAMENTOS)]);
  const a = d.assinatura;
  const efetivo = decidirEstadoEfetivo(
    {
      suspensoManualEm: d.suspensoManualEm,
      assinatura: a === null ? null : { estado: a.estado, carenciaAte: a.carenciaAte, acessoAte: a.acessoAte },
    },
    agora,
  );
  const datas: DatasDaTela = {};
  if (a !== null) {
    if (efetivo.estado === 'em_teste' && a.testeFimEm) datas.testeFimEm = a.testeFimEm;
    if (efetivo.estado === 'ativa' && a.periodoPagoAte) datas.periodoPagoAte = a.periodoPagoAte;
    if (efetivo.estado === 'em_carencia' && a.carenciaAte) datas.carenciaAte = a.carenciaAte;
    if (efetivo.estado === 'cancelada' && a.acessoAte) datas.acessoAte = a.acessoAte;
  }
  return {
    estado: efetivo.estado,
    estadoReal: a !== null && (ESTADOS_ASSINATURA as readonly string[]).includes(a.estado) ? (a.estado as EstadoAssinatura) : null,
    fuso: d.fuso,
    datas,
    acoes: acoesDoEstado(efetivo.estado),
    pagamentos: pagos.map((p) => ({ data: p.criadoEm, valorCentavos: p.valorCentavos, situacao: p.status })),
  };
}
