import { FINALIDADES, type Finalidade } from '@/config/termos';
import type { ContextoEscopado } from '@/server/tenant/context';

import { MENSAGENS_CONSENTIMENTO, type ErrosConsentimento, type OrigemConsentimento } from './tipos';

/** RN-19: só `true` (objeto) ou 'on' (caixa nativa) vale como aceite. */
export function ehAceite(v: unknown): boolean {
  return v === true || v === 'on';
}

/** Leitura segura: só propriedade própria (nunca a cadeia de protótipos). */
function lerCampo(entrada: object, nome: string): unknown {
  return Object.hasOwn(entrada, nome) ? (entrada as Record<string, unknown>)[nome] : undefined;
}

/**
 * Valida a entrada de aceites (RN-1, RN-19, A-10). `entrada` pode ser qualquer coisa: nunca lança.
 * A obrigatória vem primeiro; `convite_avaliacao` só entra quando aceita. Chaves extras ignoradas.
 */
export function validarConsentimentoDaReserva(
  entrada: unknown,
): { ok: true; finalidades: Finalidade[] } | { ok: false; erros: ErrosConsentimento } {
  const objeto = typeof entrada === 'object' && entrada !== null && !Array.isArray(entrada) ? entrada : null;
  if (objeto === null || !ehAceite(lerCampo(objeto, 'mensagensReserva'))) {
    return { ok: false, erros: { mensagensReserva: MENSAGENS_CONSENTIMENTO.mensagensReserva } };
  }
  const finalidades: Finalidade[] = ['mensagens_reserva'];
  if (ehAceite(lerCampo(objeto, 'conviteAvaliacao'))) finalidades.push('convite_avaliacao');
  return { ok: true, finalidades };
}

export function validarFinalidade(v: unknown): v is Finalidade {
  return (FINALIDADES as readonly unknown[]).includes(v);
}

/** RN-11: contexto de equipe (`tenant`) ⇒ `equipe`; de sistema ⇒ `publico`. Incoerência: RangeError. */
export function validarOrigemParaContexto(ctx: ContextoEscopado, origem: OrigemConsentimento): void {
  const esperada: OrigemConsentimento = ctx.tipo === 'tenant' ? 'equipe' : 'publico';
  if (origem !== esperada) {
    throw new RangeError(`origem de consentimento incoerente com o contexto (${ctx.tipo}): ${String(origem)}`);
  }
}

/** RN-6/RN-7: só `mensagens_reserva` aceita origem `equipe`. */
export function validarOrigemParaFinalidade(origem: OrigemConsentimento, finalidade: Finalidade): void {
  if (origem !== 'publico' && origem !== 'equipe') {
    throw new RangeError(`origem de consentimento inválida: ${String(origem)}`);
  }
  if (origem === 'equipe' && finalidade !== 'mensagens_reserva') {
    throw new RangeError(`a equipe não declara o consentimento ${finalidade}`);
  }
}
