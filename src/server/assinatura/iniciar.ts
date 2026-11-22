import { ROTAS } from '@/config/navegacao';
import { validarEnv } from '@/server/env';
import { integracoes } from '@/server/integrations/registry';
import { ErroMercadoPago } from '@/server/integrations/mercadopago/port';
import type { AssinaturaProvedor, PortaMercadoPago } from '@/server/integrations/mercadopago/port';
import { repos } from '@/server/repos';
import { emTransacao } from '@/server/repos/transacao';
import type { ContextoEscopado } from '@/server/tenant/context';

import type { ResultadoIniciar } from './iniciar-tipos';
import { processarAutorizada } from './retorno';
import { aplicarEventoAssinatura } from './servico';

// Início da assinatura (D-040 RN-1..RN-5). T1 cria/reutiliza a `pendente` sob a trava do salão e
// comita; a chamada ao provedor NUNCA ocorre com transação aberta; T2 grava o vínculo por
// compare-and-swap. Quem perde a corrida cancela a que criou e pede para tentar de novo.

export type DepsIniciar = {
  mp?: PortaMercadoPago;
  appUrl?: string;
  log?: (evento: string, campos: Record<string, unknown>) => void;
};

/** `APP_URL` pode ter barra final ou caminho: a URL de retorno é resolvida a partir da origem. */
export function urlDeRetorno(appUrl: string): string {
  return new URL(ROTAS.assinaturaRetorno, appUrl).toString();
}

async function cancelarMelhorEsforco(mp: PortaMercadoPago, id: string, log: DepsIniciar['log']): Promise<void> {
  try {
    await mp.cancelarAssinatura(id);
  } catch {
    log?.('assinatura.cancelamento_provedor_falhou', {});
  }
}

export async function iniciarAssinatura(
  ctx: ContextoEscopado,
  agora: Date,
  deps: DepsIniciar = {},
): Promise<ResultadoIniciar> {
  const vigente = await emTransacao(async (r) => {
    await r.saloes.travar(ctx);
    // RN-8 (D-042): uma `cancelada` com o acesso vencido é encerrada aqui, sem esperar o job, para que
    // a nova pendente possa nascer. Ordem salão → assinatura; nenhuma chamada ao provedor na transação.
    const alvo = await r.assinaturas.travar(ctx, {});
    if (alvo !== null && alvo !== 'ocupada' && alvo.estado === 'cancelada') {
      await aplicarEventoAssinatura(ctx, { tipo: 'prazo' }, agora, { r, assinaturaId: alvo.id });
    }
    await r.assinaturas.criarPendenteSeNaoHouver(ctx, agora);
    return r.assinaturas.lerVigente(ctx);
  });
  if (vigente === null) return { resultado: 'tente_novamente' };
  if (vigente.estado !== 'pendente') return { resultado: 'recusado', motivo: 'ja_existe' };

  const mp = deps.mp ?? integracoes().mercadoPago;
  const antigo = vigente.provedorAssinaturaId;
  let cancelarAntigo = false;
  if (antigo !== null) {
    let p: AssinaturaProvedor | null = null;
    try {
      p = await mp.consultarAssinatura(antigo);
    } catch (e) {
      if (!(e instanceof ErroMercadoPago) || e.codigo !== 'nao_encontrado') {
        deps.log?.('assinatura.iniciar_consulta_falhou', { assinaturaId: vigente.id });
        return { resultado: 'provedor_indisponivel' };
      }
    }
    if (p !== null && p.salaoId === ctx.salaoId) {
      if (p.estado === 'autorizada') {
        const r = await processarAutorizada(ctx, vigente, p, agora, deps);
        return r === 'teste_iniciado' || r === 'ja_em_teste' ? { resultado: 'teste_iniciado' } : { resultado: 'tente_novamente' };
      }
      cancelarAntigo = p.estado === 'pendente';
    }
  }

  if (vigente.emailGestor === null) return { resultado: 'provedor_indisponivel' };
  let criada: { assinaturaId: string; urlCheckout: string };
  try {
    const appUrl = deps.appUrl ?? validarEnv(process.env).APP_URL;
    criada = await mp.criarAssinatura({ salaoId: ctx.salaoId, emailPagador: vigente.emailGestor, urlRetorno: urlDeRetorno(appUrl) });
  } catch (e) {
    if (!(e instanceof ErroMercadoPago)) throw e;
    deps.log?.('assinatura.iniciar_falhou', { assinaturaId: vigente.id });
    return { resultado: 'provedor_indisponivel' };
  }

  const gravou = await repos().assinaturas.trocarProvedor(ctx, {
    id: vigente.id,
    de: antigo,
    para: criada.assinaturaId,
    agora,
  });
  if (!gravou) {
    await cancelarMelhorEsforco(mp, criada.assinaturaId, deps.log);
    return { resultado: 'tente_novamente' };
  }
  if (antigo !== null && cancelarAntigo) {
    await cancelarMelhorEsforco(mp, antigo, deps.log);
  }
  return { resultado: 'iniciada', urlCheckout: criada.urlCheckout };
}
