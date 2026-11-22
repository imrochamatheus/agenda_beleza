import { PRECO_MENSAL_CENTAVOS } from '@/config/plano';
import { integracoes } from '@/server/integrations/registry';
import type { AssinaturaProvedor, PortaMercadoPago } from '@/server/integrations/mercadopago/port';
import { repos } from '@/server/repos';
import type { AssinaturaVigente } from '@/server/repos/assinatura';
import { emTransacao } from '@/server/repos/transacao';
import type { ContextoEscopado } from '@/server/tenant/context';

import type { ResultadoRetorno } from './iniciar-tipos';
import { aplicarEventoAssinatura } from './servico';

// Retorno do checkout (D-040 RN-6..RN-9). O navegador só dispara a consulta: nenhum parâmetro da
// requisição entra aqui. O provedor é consultado FORA de transação (RN-4) e só uma autorização
// confirmada por ele inicia o teste, com o fim contado da autorização.

export type DepsRetorno = {
  mp?: PortaMercadoPago;
  log?: (evento: string, campos: Record<string, unknown>) => void;
};

/** Aplica a autorização já consultada: confirma o vínculo sob a trava e usa `aplicarEventoAssinatura`. */
export async function processarAutorizada(
  ctx: ContextoEscopado,
  vigente: Pick<AssinaturaVigente, 'id'>,
  p: AssinaturaProvedor,
  agora: Date,
  deps: Pick<DepsRetorno, 'log'> = {},
): Promise<ResultadoRetorno> {
  if (p.valorCentavos !== PRECO_MENSAL_CENTAVOS) {
    deps.log?.('assinatura.valor_divergente', { assinaturaId: vigente.id });
  }
  return emTransacao(async (r) => {
    if (!(await r.assinaturas.confirmarProvedor(ctx, { id: vigente.id, provedorId: p.id }))) {
      return 'neutro';
    }
    const res = await aplicarEventoAssinatura(
      ctx,
      { tipo: 'teste_iniciado', iniciadoEm: p.autorizadaEm ?? agora },
      agora,
      { r, assinaturaId: vigente.id, ...(deps.log ? { log: deps.log } : {}) },
    );
    if (res.resultado === 'aplicado') return 'teste_iniciado';
    if (res.resultado === 'sem_efeito') return 'ja_em_teste';
    return 'neutro';
  });
}

/** Nunca lança por erro do provedor. */
export async function consultarRetorno(
  ctx: ContextoEscopado,
  agora: Date,
  deps: DepsRetorno = {},
): Promise<ResultadoRetorno> {
  const vigente = await repos().assinaturas.lerVigente(ctx);
  if (vigente === null || vigente.provedorAssinaturaId === null) {
    return 'sem_assinatura';
  }
  let p: AssinaturaProvedor;
  try {
    p = await (deps.mp ?? integracoes().mercadoPago).consultarAssinatura(vigente.provedorAssinaturaId);
  } catch {
    deps.log?.('assinatura.retorno_indisponivel', { assinaturaId: vigente.id });
    return 'indisponivel';
  }
  if (p.salaoId !== ctx.salaoId) {
    deps.log?.('assinatura.vinculo_invalido', { assinaturaId: vigente.id });
    return 'vinculo_invalido';
  }
  if (p.estado === 'autorizada') {
    return processarAutorizada(ctx, vigente, p, agora, deps);
  }
  if (vigente.estado !== 'pendente') return 'neutro';
  return p.estado === 'pendente' ? 'aguardando' : 'cancelada_no_provedor';
}
