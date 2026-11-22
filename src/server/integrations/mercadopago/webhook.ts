import { createHmac, timingSafeEqual } from 'node:crypto';

import { montarManifesto, tsParaMs } from './mapeamento';
import type { NotificacaoWebhook, ResultadoValidacaoWebhook } from './port';
import { TIPOS_MP, type TipoNotificacao } from './webhook-simulado';

// Validação de origem do webhook do Mercado Pago real (D-046, RN-5..RN-7). Nunca lança.

/** Janela de replay: decisão nossa (a documentação do MP não define); fixa, não é variável de ambiente. */
export const JANELA_REPLAY_MS = 5 * 60_000;

const TIPO_POR_TIPO_MP = new Map<string, TipoNotificacao>(
  Object.entries(TIPOS_MP).map(([tipo, tipoMp]) => [tipoMp, tipo as TipoNotificacao]),
);

function texto(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}

/** `ts=<dígitos>,v1=<64 hex>` em qualquer ordem; outra forma → null. */
function lerAssinatura(cabecalho: string): { ts: string; v1: string } | null {
  const partes = new Map<string, string>();
  for (const parte of cabecalho.split(',')) {
    const i = parte.indexOf('=');
    if (i > 0) partes.set(parte.slice(0, i).trim(), parte.slice(i + 1).trim());
  }
  const ts = partes.get('ts');
  const v1 = partes.get('v1');
  if (!ts || !/^\d{1,16}$/.test(ts) || !v1 || !/^[0-9a-f]{64}$/i.test(v1)) return null;
  return { ts, v1 };
}

function campo(v: unknown, nome: string): unknown {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>)[nome] : undefined;
}

function confere(segredo: string, manifesto: string, v1: string): boolean {
  const esperada = createHmac('sha256', segredo).update(manifesto).digest();
  const recebida = Buffer.from(v1, 'hex');
  return recebida.length === esperada.length && timingSafeEqual(recebida, esperada);
}

/**
 * Válida só se: cabeçalhos e `data.id`/`type` presentes, `ts` dentro de ±5 min (inclusive), HMAC-SHA256
 * do manifest conferido em tempo constante (com o `data.id` como recebido e, se tiver maiúsculas, também
 * em minúsculas), corpo coerente com a query e `type` conhecido. `corpoBruto` é ignorado.
 */
export function validarWebhookReal(
  n: NotificacaoWebhook,
  o: { segredo: string; agora: Date },
): ResultadoValidacaoWebhook {
  const invalida = { valida: false } as const;
  try {
    const requestId = texto(n.cabecalhos['x-request-id']);
    const assinatura = texto(n.cabecalhos['x-signature']);
    const dataId = texto(n.consulta['data.id']);
    const tipoMp = texto(n.consulta.type);
    if (!requestId || !assinatura || !dataId || !tipoMp) return invalida;

    const tipo = TIPO_POR_TIPO_MP.get(tipoMp);
    if (!tipo) return invalida;

    const lida = lerAssinatura(assinatura);
    if (!lida) return invalida;
    if (Math.abs(o.agora.getTime() - tsParaMs(lida.ts)) > JANELA_REPLAY_MS) return invalida;

    const idCorpo = campo(campo(n.corpo, 'data'), 'id');
    if (idCorpo !== undefined) {
      if ((typeof idCorpo !== 'string' && typeof idCorpo !== 'number') || String(idCorpo).toLowerCase() !== dataId.toLowerCase()) {
        return invalida;
      }
    }
    const tipoCorpo = campo(n.corpo, 'type');
    if (tipoCorpo !== undefined && tipoCorpo !== tipoMp) return invalida;

    const candidatos = dataId === dataId.toLowerCase() ? [dataId] : [dataId, dataId.toLowerCase()];
    // Sem curto-circuito entre candidatos: o custo não depende de qual conferiu.
    const resultados = candidatos.map((id) =>
      confere(o.segredo, montarManifesto({ dataId: id, requestId, ts: lida.ts }), lida.v1),
    );
    if (!resultados.some(Boolean)) return invalida;

    return { valida: true, tipo, recursoId: dataId };
  } catch {
    return invalida;
  }
}
