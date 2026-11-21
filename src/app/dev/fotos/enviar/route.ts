import { ROTAS } from '@/config/navegacao';
import { vitrineHabilitada } from '@/server/env';
import { tratarEnvio } from '@/server/fotos/envio-http';

import { demonstrarEnvio } from '../demonstracao';

// Envio de demonstração de /dev/fotos (D-021 §3.6, D-10): mesma tradução HTTP do envio real
// (Origin, 303 com código), mas sem sessão nem armazenamento: valida e processa em memória, não grava.
// A origem esperada é a do próprio Host da requisição (a vitrine não tem APP_URL garantido; o Next
// monta request.url com o hostname de escuta, não com o Host). 404 sem a vitrine.

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Origem esperada: o protocolo do próprio Origin com o host da requisição (a vitrine é same-origin). */
function origemEsperada(request: Request): string {
  const host = request.headers.get('host');
  try {
    const protocolo = new URL(request.headers.get('origin') ?? '').protocol;
    return host ? `${protocolo}//${host}` : 'http://sem-host.invalid';
  } catch {
    return 'http://sem-origin.invalid';
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!vitrineHabilitada(process.env)) {
    return new Response(null, { status: 404 });
  }
  return tratarEnvio(request, { executar: demonstrarEnvio, appUrl: origemEsperada(request), destino: ROTAS.devFotos });
}
