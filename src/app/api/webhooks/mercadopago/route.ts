import { tratarWebhook } from '@/server/assinatura/webhook-http';

// Webhook do Mercado Pago (D-041). Fora do matcher do proxy (sem cookie nem CSRF): a origem é validada
// pela porta (`integracoes().mercadoPago`). A rota não toca repositórios nem o segredo.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  return tratarWebhook(request);
}

const metodoNaoPermitido = () => new Response(null, { status: 405, headers: { allow: 'POST' } });
export const GET = metodoNaoPermitido;
export const HEAD = metodoNaoPermitido;
export const PUT = metodoNaoPermitido;
export const PATCH = metodoNaoPermitido;
export const DELETE = metodoNaoPermitido;
