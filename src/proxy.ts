import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { ROTAS } from '@/config/navegacao';
import { NOME_COOKIE_SESSAO } from '@/server/auth/cookie';

// Proxy otimista do painel (D-010 RN-16, §3.11). Só confere a PRESENÇA do cookie de sessão: não
// acessa banco, não lê papel e não decide permissão (a autorização real fica nas páginas e ações,
// RN-17). Imports restritos a next/server, auth/cookie e navegacao (R-6: nada de Prisma/argon2 aqui).

function ehDoPainel(pathname: string): boolean {
  return pathname === ROTAS.painel || pathname.startsWith(`${ROTAS.painel}/`);
}

export function proxy(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;
  // Defesa caso o matcher mude: fora do painel, nunca intercepta.
  if (!ehDoPainel(pathname)) {
    return NextResponse.next();
  }
  if (request.cookies.get(NOME_COOKIE_SESSAO)?.value) {
    return NextResponse.next();
  }
  const destino = new URL(`${ROTAS.entrar}?proximo=${encodeURIComponent(pathname + search)}`, request.url);
  return NextResponse.redirect(destino, 307);
}

export const config = { matcher: ['/painel', '/painel/:path*'] };
