import { CAPACIDADES_OPERACIONAIS } from '@/domain/assinatura';
import type { EstadoEfetivo } from '@/domain/assinatura';
import type { ContextoEscopado } from '@/server/tenant/context';
import type { DecisaoPolitica, PoliticaOperacao } from '@/server/tenant/politica';

import { estadoEfetivoDoSalao } from './estado-operacional';

/**
 * Decisão pura (D-038 RN-1): a capacidade pedida precisa existir na tabela do estado efetivo e valer
 * exatamente `true`. Capacidade desconhecida, ausente ou não booleana: negado (falha fechada, RN-3).
 */
export function decidirPolitica(estado: EstadoEfetivo, capacidade: string): DecisaoPolitica {
  const conhecida = (CAPACIDADES_OPERACIONAIS as readonly string[]).includes(capacidade);
  const caps: unknown = estado?.capacidades;
  const valor = conhecida && typeof caps === 'object' && caps !== null && Object.hasOwn(caps, capacidade)
    ? (caps as Record<string, unknown>)[capacidade]
    : undefined;
  if (valor === true) return { permitido: true };
  return { permitido: false, motivo: `somente_leitura:${capacidade}:${estado?.estado ?? 'desconhecido'}` };
}

/**
 * Política real: lê o estado efetivo do salão do contexto (um comando, fora de transação e sem trava:
 * a política roda antes de qualquer trava e não participa de ciclo) e aplica a tabela única.
 * Qualquer falha de leitura nega (nunca 500) e registra só o `salaoId`.
 */
export const politicaPorEstado: PoliticaOperacao = async (ctx: ContextoEscopado, capacidade, agora) => {
  let estado: EstadoEfetivo;
  try {
    estado = await estadoEfetivoDoSalao(ctx, agora);
  } catch {
    console.warn(JSON.stringify({ evento: 'politica.estado_ilegivel', salaoId: ctx.salaoId }));
    return { permitido: false, motivo: 'estado_ilegivel' };
  }
  return decidirPolitica(estado, capacidade);
};

/** Política em vigor (substitui a política antiga, que permitia tudo). */
export const politicaDeOperacao: PoliticaOperacao = politicaPorEstado;
