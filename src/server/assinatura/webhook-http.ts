import { LIMITE_CORPO_BYTES } from './webhook-decisao';
import { receberWebhook } from './webhook';
import type { DepsWebhook, EntradaWebhook, RespostaWebhook } from './webhook';

// Tradução HTTP do webhook (D-041 §2). Só Request/Response (sem next/*). O corpo é contado em
// streaming e nunca lido acima de 16 KiB; cabeçalhos e consulta nunca são gravados, só repassados à porta.

async function lerCorpoLimitado(request: Request): Promise<string | null> {
  const declarado = Number(request.headers.get('content-length'));
  if (Number.isFinite(declarado) && declarado > LIMITE_CORPO_BYTES) {
    await request.body?.cancel().catch(() => undefined);
    return null;
  }
  if (!request.body) return '';
  const leitor = request.body.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.byteLength;
    if (total > LIMITE_CORPO_BYTES) {
      await leitor.cancel().catch(() => undefined);
      return null;
    }
    partes.push(value);
  }
  return Buffer.concat(partes).toString('utf8');
}

function paraResponse(r: RespostaWebhook): Response {
  const headers: Record<string, string> = { 'cache-control': 'no-store' };
  if (r.status === 503 && r.retryAfter !== undefined) headers['retry-after'] = String(r.retryAfter);
  return Response.json(r.corpo, { status: r.status, headers });
}

export async function tratarWebhook(request: Request, deps: DepsWebhook & { agora?: Date } = {}): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(null, { status: 405, headers: { allow: 'POST' } });
  }
  const cabecalhos: Record<string, string> = {};
  request.headers.forEach((v, k) => {
    cabecalhos[k.toLowerCase()] = v;
  });
  const consulta: Record<string, string> = {};
  new URL(request.url).searchParams.forEach((v, k) => {
    consulta[k] = v;
  });
  const corpoBruto = await lerCorpoLimitado(request);
  const entrada: EntradaWebhook = { cabecalhos, consulta, corpoBruto };
  if (corpoBruto !== null) {
    try {
      entrada.corpo = JSON.parse(corpoBruto);
    } catch {
      entrada.jsonInvalido = true;
    }
  }
  try {
    return paraResponse(await receberWebhook(entrada, deps.agora ?? new Date(), deps));
  } catch {
    // Falha inesperada (banco fora do ar): o MP deve reenviar.
    return paraResponse({ status: 503, corpo: { erro: 'indisponivel' }, retryAfter: 60 });
  }
}
