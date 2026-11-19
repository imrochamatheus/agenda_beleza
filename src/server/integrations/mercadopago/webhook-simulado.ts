import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

import type { NotificacaoWebhook, ResultadoValidacaoWebhook } from './port';

// Notificações de webhook do MP simulado (RN-17, D-6), no formato do Mercado Pago: query string com
// `data.id` e `type`, corpo JSON e os cabeçalhos de origem `x-request-id` e
// `x-signature: ts=<ms>,v1=<hex>`, com HMAC-SHA256 de `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`.

/** Segredo FIXO e documentado do simulado. Não é segredo: só imita a validação de origem do MP. */
export const SEGREDO_WEBHOOK_SIMULADO = 'segredo-do-webhook-simulado';

export type TipoNotificacao = 'assinatura' | 'pagamento';

/** `type` do MP para cada tipo de recurso da porta. */
export const TIPOS_MP: Readonly<Record<TipoNotificacao, string>> = {
  assinatura: 'subscription_preapproval',
  pagamento: 'subscription_authorized_payment',
};

const TIPO_POR_TIPO_MP = new Map<string, TipoNotificacao>(
  Object.entries(TIPOS_MP).map(([tipo, tipoMp]) => [tipoMp, tipo as TipoNotificacao]),
);

function manifesto(dataId: string, requestId: string, ts: string): string {
  return `id:${dataId};request-id:${requestId};ts:${ts};`;
}

function assinar(dataId: string, requestId: string, ts: string): Buffer {
  return createHmac('sha256', SEGREDO_WEBHOOK_SIMULADO).update(manifesto(dataId, requestId, ts)).digest();
}

/** A notificação que o MP enviaria para o recurso, assinada no instante `em`. */
export function notificacaoSimulada(
  tipo: TipoNotificacao,
  recursoId: string,
  em: Date,
  requestId: string = randomUUID(),
): NotificacaoWebhook {
  const tipoMp = TIPOS_MP[tipo];
  const ts = String(em.getTime());
  const v1 = assinar(recursoId, requestId, ts).toString('hex');
  return {
    cabecalhos: { 'x-request-id': requestId, 'x-signature': `ts=${ts},v1=${v1}` },
    consulta: { 'data.id': recursoId, type: tipoMp },
    corpo: { type: tipoMp, action: 'updated', data: { id: recursoId } },
  };
}

/** `ts=<dígitos>,v1=<64 hex>`, em qualquer ordem; qualquer outra forma → null. */
function lerAssinatura(cabecalho: string): { ts: string; v1: string } | null {
  const partes = new Map<string, string>();
  for (const parte of cabecalho.split(',')) {
    const i = parte.indexOf('=');
    if (i > 0) partes.set(parte.slice(0, i).trim(), parte.slice(i + 1).trim());
  }
  const ts = partes.get('ts');
  const v1 = partes.get('v1');
  if (!ts || !/^\d+$/.test(ts) || !v1 || !/^[0-9a-f]{64}$/i.test(v1)) return null;
  return { ts, v1 };
}

function texto(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}

/** Campo `campo` de um objeto qualquer, ou undefined (sem lançar). */
function campo(v: unknown, nome: string): unknown {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>)[nome] : undefined;
}

/**
 * Validação de origem do simulado (CA-16). Válida só se a assinatura confere (comparação em tempo
 * constante), o `type` é conhecido e o corpo, quando traz `data.id` ou `type`, concorda com a
 * consulta. Nunca lança. Sem janela de tempo do `ts` (D-6: é da E6.6/E6.2).
 */
export function validarNotificacaoSimulada(n: NotificacaoWebhook): ResultadoValidacaoWebhook {
  const invalida = { valida: false } as const;
  try {
    const requestId = texto(n.cabecalhos['x-request-id']);
    const assinatura = texto(n.cabecalhos['x-signature']);
    const dataId = texto(n.consulta['data.id']);
    const tipoMp = texto(n.consulta.type);
    if (!requestId || !assinatura || !dataId || !tipoMp) return invalida;

    const tipo = TIPO_POR_TIPO_MP.get(tipoMp);
    if (!tipo) return invalida;

    const dadosCorpo = campo(n.corpo, 'data');
    const idCorpo = campo(dadosCorpo, 'id');
    if (idCorpo !== undefined && idCorpo !== dataId) return invalida;
    const tipoCorpo = campo(n.corpo, 'type');
    if (tipoCorpo !== undefined && tipoCorpo !== tipoMp) return invalida;

    const lida = lerAssinatura(assinatura);
    if (!lida) return invalida;
    const esperada = assinar(dataId, requestId, lida.ts);
    if (!timingSafeEqual(Buffer.from(lida.v1, 'hex'), esperada)) return invalida;

    return { valida: true, tipo, recursoId: dataId };
  } catch {
    // Entrada malformada (cabeçalhos ou consulta ausentes): inválida, nunca exceção.
    return invalida;
  }
}
