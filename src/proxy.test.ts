import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import { config, proxy } from './proxy';

// CA-9 (RN-16): proxy otimista com NextRequest real, sem banco.
const BASE = 'http://127.0.0.1:3000';

function requisicao(caminho: string, cookie?: string): NextRequest {
  return new NextRequest(new URL(caminho, BASE), cookie === undefined ? {} : { headers: { cookie } });
}

/** Destino do redirecionamento: mesma origem da requisição (o NextURL normaliza 127.0.0.1 para localhost). */
function destino(r: Response, req: NextRequest): string {
  const url = new URL(r.headers.get('location')!);
  expect(url.origin).toBe(req.nextUrl.origin);
  return url.pathname + url.search;
}

/** NextResponse.next() sinaliza "seguir" pelo cabeçalho x-middleware-next. */
const segue = (r: Response) => r.headers.get('x-middleware-next') === '1' && r.headers.get('location') === null;

describe('CA-9: proxy do painel', () => {
  it('CA-9: GET /painel/agenda?x=1 sem cookie → 307 para /entrar?proximo=%2Fpainel%2Fagenda%3Fx%3D1', () => {
    const req = requisicao('/painel/agenda?x=1');
    const r = proxy(req);
    expect(r.status).toBe(307);
    expect(destino(r, req)).toBe('/entrar?proximo=%2Fpainel%2Fagenda%3Fx%3D1');
  });

  it('CA-9: /painel sem cookie → 307 com proximo=%2Fpainel', () => {
    const req = requisicao('/painel');
    const r = proxy(req);
    expect(r.status).toBe(307);
    expect(destino(r, req)).toBe('/entrar?proximo=%2Fpainel');
  });

  it('CA-9: cookie ab_sessao com qualquer valor não vazio → segue, sem validar', () => {
    for (const valor of ['qualquer', 'token-invalido-ou-revogado']) {
      expect(segue(proxy(requisicao('/painel/agenda', `ab_sessao=${valor}`)))).toBe(true);
    }
  });

  it('CA-9: cookie vazio ou só de outro nome → redireciona', () => {
    expect(proxy(requisicao('/painel', 'ab_sessao=')).status).toBe(307);
    expect(proxy(requisicao('/painel', 'outro=valor')).status).toBe(307);
  });

  it.each(['/', '/entrar', '/api/health', '/salao-x', '/painelx', '/adminx'])('CA-9: %s não é interceptado', (caminho) => {
    expect(segue(proxy(requisicao(caminho)))).toBe(true);
  });

  it('CA-9: matcher do painel e (D-034) do admin', () => {
    expect(config).toEqual({ matcher: ['/painel', '/painel/:path*', '/admin', '/admin/:path*'] });
  });

  it('R-6: proxy.ts só importa next/server, os módulos puros de cookie e navegacao', () => {
    const fonte = readFileSync(fileURLToPath(new URL('./proxy.ts', import.meta.url)), 'utf8');
    const imports = [...fonte.matchAll(/^import[^;]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);
    expect([...new Set(imports)].sort()).toEqual(['@/config/navegacao', '@/server/auth/admin/cookie-admin', '@/server/auth/cookie', 'next/server']);
    expect(fonte).not.toMatch(/\brequire\(|import\(/);
  });
});

describe('D-034 CA-4: proxy do admin', () => {
  it.each(['/admin', '/admin/saloes', '/admin/x/y?z=1'])('%s sem cookie → 307 para /admin/entrar', (caminho) => {
    const req = requisicao(caminho);
    const r = proxy(req);
    expect(r.status).toBe(307);
    expect(destino(r, req)).toBe('/admin/entrar');
  });

  it('/admin/entrar nunca é interceptado (nem /admin/entrar/x)', () => {
    expect(segue(proxy(requisicao('/admin/entrar')))).toBe(true);
    expect(segue(proxy(requisicao('/admin/entrar/x')))).toBe(true);
  });

  it('com ab_admin ou ab_sessao (a página decide o 403) → segue, sem validar o valor', () => {
    expect(segue(proxy(requisicao('/admin', 'ab_admin=qualquer')))).toBe(true);
    expect(segue(proxy(requisicao('/admin/saloes', 'ab_sessao=de-gestor')))).toBe(true);
  });

  it('cookie vazio ou de outro nome → 307', () => {
    expect(proxy(requisicao('/admin', 'ab_admin=')).status).toBe(307);
    expect(proxy(requisicao('/admin', 'outro=valor')).status).toBe(307);
  });
});
