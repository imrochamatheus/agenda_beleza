import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { ROTAS } from '@/config/navegacao';
import { NOME_COOKIE_ADMIN } from '@/server/auth/admin/cookie-admin';
import { NOME_COOKIE_SESSAO } from '@/server/auth/cookie';

// Proxy otimista do painel (D-010 RN-16, §3.11). Só confere a PRESENÇA do cookie de sessão: não
// acessa banco, não lê papel e não decide permissão (a autorização real fica nas páginas e ações,
// RN-17). Imports restritos a next/server, auth/cookie e navegacao (R-6: nada de Prisma/argon2 aqui).

function ehDoPainel(pathname: string): boolean {
  return pathname === ROTAS.painel || pathname.startsWith(`${ROTAS.painel}/`);
}

function ehDoAdmin(pathname: string): boolean {
  return pathname === ROTAS.admin || pathname.startsWith(`${ROTAS.admin}/`);
}

// D-034 (RN-10): em /admin/** o proxy também só confere a PRESENÇA de cookie. Sem nenhum cookie →
// 307 para /admin/entrar (que fica de fora). Com `ab_sessao` (gestor/profissional) mas sem `ab_admin`
// a requisição passa: quem decide o 403 é a página (exigirAcessoAoAdmin). A autorização real nunca é
// do proxy.
function proxyDoAdmin(request: NextRequest, pathname: string): NextResponse {
  if (pathname === ROTAS.adminEntrar || pathname.startsWith(`${ROTAS.adminEntrar}/`)) {
    return NextResponse.next();
  }
  if (request.cookies.get(NOME_COOKIE_ADMIN)?.value || request.cookies.get(NOME_COOKIE_SESSAO)?.value) {
    return NextResponse.next();
  }
  return NextResponse.redirect(new URL(ROTAS.adminEntrar, request.url), 307);
}

export function proxy(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;
  if (ehDoAdmin(pathname)) {
    return proxyDoAdmin(request, pathname);
  }
  // Defesa caso o matcher mude: fora do painel e do admin, nunca intercepta.
  if (!ehDoPainel(pathname)) {
    return NextResponse.next();
  }
  if (request.cookies.get(NOME_COOKIE_SESSAO)?.value) {
    return NextResponse.next();
  }
  const destino = new URL(`${ROTAS.entrar}?proximo=${encodeURIComponent(pathname + search)}`, request.url);
  return NextResponse.redirect(destino, 307);
}

export const config = { matcher: ['/painel', '/painel/:path*', '/admin', '/admin/:path*'] };
