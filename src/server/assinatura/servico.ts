import { decidir } from '@/domain/assinatura';
import type { Decisao, EstadoAssinatura } from '@/domain/assinatura';
import { PRECO_MENSAL_CENTAVOS } from '@/config/plano';
import { emTransacao } from '@/server/repos/transacao';
import type { Repos } from '@/server/repos';
import type { ContextoEscopado } from '@/server/tenant/context';

import type { EventoAssinatura, ResultadoAssinatura } from './tipos';

// Ponto único de mudança de estado da assinatura (D-037 §3.1). Uma transação READ COMMITTED (ou a
// de `opcoes.r`); regra de negócio nunca lança (resultado discriminado); erro de banco propaga e
// desfaz tudo, inclusive o pagamento já registrado. O estado do salão (suspensão manual) é independente.

export type OpcoesAplicarEvento = {
  assinaturaId?: string;
  /** Origem do evento (webhook_evento.id), gravada em assinatura_transicao.evento_id. */
  eventoId?: string;
  r?: Repos;
  /** O job usa `true`: linha travada por outra transação → `ocupada`, sem esperar. */
  pularTravada?: boolean;
  /** Só para teste: roda logo depois de registrar o pagamento (CA-12: falha desfaz tudo). */
  aposRegistrarPagamento?: () => Promise<void>;
  log?: (evento: string, campos: Record<string, unknown>) => void;
};

export async function aplicarEventoAssinatura(
  ctx: ContextoEscopado,
  ev: EventoAssinatura,
  agora: Date,
  opcoes: OpcoesAplicarEvento = {},
): Promise<ResultadoAssinatura> {
  if (opcoes.r) {
    return executar(opcoes.r, ctx, ev, agora, opcoes);
  }
  return emTransacao((r) => executar(r, ctx, ev, agora, opcoes));
}

function dadosDoPagamento(ev: EventoAssinatura): { pagamentoId: string; status: 'aprovado' | 'recusado'; valor: number } | null {
  if (ev.tipo === 'cobranca_aprovada') {
    return { pagamentoId: ev.pagamentoId, status: 'aprovado', valor: ev.valorCentavos };
  }
  if (ev.tipo === 'cobranca_falhou' && ev.pagamentoId !== undefined) {
    return { pagamentoId: ev.pagamentoId, status: 'recusado', valor: ev.valorCentavos ?? PRECO_MENSAL_CENTAVOS };
  }
  return null;
}

function paraEventoDominio(ev: EventoAssinatura) {
  switch (ev.tipo) {
    case 'cobranca_aprovada':
      return { tipo: 'cobranca_aprovada', pagoEm: ev.pagoEm } as const;
    case 'cobranca_falhou':
      return { tipo: 'cobranca_falhou', falhouEm: ev.falhouEm } as const;
    default:
      return { tipo: ev.tipo } as const;
  }
}

async function executar(
  r: Repos,
  ctx: ContextoEscopado,
  ev: EventoAssinatura,
  agora: Date,
  o: OpcoesAplicarEvento,
): Promise<ResultadoAssinatura> {
  const pagamento = dadosDoPagamento(ev);
  const alvo = await r.assinaturas.travar(ctx, {
    ...(o.assinaturaId !== undefined ? { assinaturaId: o.assinaturaId } : {}),
    pularTravada: o.pularTravada === true,
    recenteSeNaoHouver: pagamento !== null,
  });
  if (alvo === 'ocupada') {
    return { resultado: 'ocupada' };
  }
  if (alvo === null) {
    return { resultado: 'sem_assinatura' };
  }

  let linhaPagamento: string | null = null;
  if (pagamento !== null) {
    linhaPagamento = await r.assinaturas.inserirPagamento(ctx, {
      assinaturaId: alvo.id,
      pagamentoId: pagamento.pagamentoId,
      status: pagamento.status,
      valorCentavos: pagamento.valor,
    });
    if (linhaPagamento === null) {
      return { resultado: 'sem_efeito', motivo: 'pagamento_duplicado' };
    }
    if (o.aposRegistrarPagamento) {
      await o.aposRegistrarPagamento();
    }
    if (ev.tipo === 'cobranca_aprovada' && ev.valorCentavos !== PRECO_MENSAL_CENTAVOS) {
      o.log?.('assinatura.valor_divergente', { assinaturaId: alvo.id });
    }
  }

  const decisao: Decisao = decidir(alvo, paraEventoDominio(ev), agora);
  if (decisao.tipo === 'ignorado') {
    return { resultado: 'ignorado', motivo: decisao.motivo };
  }
  if (decisao.tipo === 'sem_efeito') {
    return { resultado: 'sem_efeito' };
  }
  if (decisao.tipo === 'atualiza') {
    await r.assinaturas.atualizarPeriodoPago(ctx, { id: alvo.id, periodoPagoAte: decisao.campos.periodoPagoAte, agora });
    if (linhaPagamento !== null) await r.assinaturas.marcarAplicado(ctx, linhaPagamento, agora);
    return { resultado: 'aplicado', de: 'ativa', para: 'ativa', transicoes: 0, pagoAte: decisao.campos.periodoPagoAte };
  }

  let pagoAte = alvo.periodoPagoAte;
  for (const passo of decisao.passos) {
    const ok = await r.assinaturas.aplicarPasso(ctx, { id: alvo.id, de: passo.de, para: passo.para, campos: passo.campos, agora });
    if (!ok) {
      // Defensivo: sob a trava o estado não muda; 0 linhas seria um erro de programação.
      o.log?.('assinatura.transicao_perdida', { assinaturaId: alvo.id });
      return { resultado: 'sem_efeito' };
    }
    await r.assinaturas.inserirTransicao(ctx, {
      assinaturaId: alvo.id,
      de: passo.de,
      para: passo.para,
      causa: passo.origem,
      eventoId: o.eventoId ?? null,
      agora,
    });
    if (passo.campos.periodoPagoAte !== undefined) pagoAte = passo.campos.periodoPagoAte;
  }
  if (linhaPagamento !== null && ev.tipo === 'cobranca_aprovada') {
    await r.assinaturas.marcarAplicado(ctx, linhaPagamento, agora);
  }
  const primeiro = decisao.passos[0];
  const ultimo = decisao.passos[decisao.passos.length - 1];
  return {
    resultado: 'aplicado',
    de: primeiro.de as EstadoAssinatura,
    para: ultimo.para,
    transicoes: decisao.passos.length,
    pagoAte,
  };
}
