import { ROTAS } from '@/config/navegacao';
import { validarEnv } from '@/server/env';
import { tratarEnvio } from '@/server/fotos/envio-http';
import { enviarFoto } from '@/server/fotos/fotos.acao';

// Envio de foto do salão (D-021 §3.6; A-3): a primeira mutação por route handler. Fica FORA do matcher
// do proxy (/painel/**), que repetiria o POST em /entrar com 307. Toda a lógica (Origin contra APP_URL,
// sessão, papel, capacidade, leitura limitada do corpo e o 303) está em src/server/fotos/envio-http.ts.

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  return tratarEnvio(request, { executar: enviarFoto, appUrl: validarEnv(process.env).APP_URL, destino: ROTAS.configuracoesFotos });
}

const metodoNaoPermitido = () => new Response(null, { status: 405, headers: { allow: 'POST' } });
export const GET = metodoNaoPermitido;
export const HEAD = metodoNaoPermitido;
export const PUT = metodoNaoPermitido;
export const PATCH = metodoNaoPermitido;
export const DELETE = metodoNaoPermitido;
