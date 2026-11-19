import type pg from 'pg';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { entrarAcao } from '@/app/(publico)/entrar/acoes';
import { ESTADO_INICIAL_ENTRAR } from '@/app/(publico)/entrar/estado';
import PaginaEntrar from '@/app/(publico)/entrar/page';
import { sairAcao } from '@/app/painel/acoes';
import PaginaPainel from '@/app/painel/page';
import { MENSAGENS_LOGIN } from '@/server/auth/login';
import { destinoSeJaAutenticado, exigirAcessoAoPainel } from '@/server/auth/pagina';
import { hashDoToken, resolverTenant } from '@/server/tenant/sessao';

import { criarSessao, criarSuperAdmin, entrarDeVerdade } from '../../support/auth';
import { SENHA_DE_TESTE, criarDoisSaloes } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { conectar } from '../../support/sql';

// D-010 T-6: casca Next com sessões reais no PostgreSQL. next/headers (cookies) e next/navigation
// (redirect) são substituídos (não é mock de banco). CA-1 e CA-4 (casca), CA-6, CA-10 e CA-17
// (painel). As páginas são renderizadas com renderToStaticMarkup, sem JSX no arquivo.

class Redirecionado extends Error {
  constructor(readonly destino: string) {
    super(`NEXT_REDIRECT ${destino}`);
  }
}

type Gravacao = { nome: string; valor: string; atributos: Record<string, unknown> };
const jar = vi.hoisted(() => ({ valor: undefined as string | undefined, gravacoes: [] as Gravacao[] }));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (nome: string) =>
      nome === 'ab_sessao' && jar.valor !== undefined ? { name: nome, value: jar.valor } : undefined,
    set: (nome: string, valor: string, atributos: Record<string, unknown>) => {
      jar.gravacoes.push({ nome, valor, atributos });
    },
  }),
}));
vi.mock('next/navigation', () => ({
  redirect: (destino: string) => {
    throw new Redirecionado(destino);
  },
  usePathname: () => null,
}));

const TRINTA_DIAS_S = 30 * 24 * 60 * 60;

let c: pg.Client;
let a: SalaoCompleto;
let b: SalaoCompleto;

beforeAll(async () => {
  c = await conectar();
  ({ a, b } = await criarDoisSaloes());
});
afterAll(async () => {
  await c.end();
});
beforeEach(() => {
  jar.valor = undefined;
  jar.gravacoes = [];
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** Executa e devolve o destino do redirect (falha se não redirecionar). */
async function destinoDe(p: Promise<unknown>): Promise<string> {
  const erro = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(erro).toBeInstanceOf(Redirecionado);
  return (erro as Redirecionado).destino;
}

function formulario(campos: Record<string, string | Blob>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
}

async function renderizarPainel(): Promise<string> {
  return renderToStaticMarkup(await PaginaPainel());
}

async function renderizarEntrar(busca: Record<string, string | string[]> = {}): Promise<string> {
  return renderToStaticMarkup(await PaginaEntrar({ searchParams: Promise.resolve(busca) }));
}

describe('CA-1 (casca): entrarAcao grava o cookie httpOnly e redireciona', () => {
  it('CA-1: gestor → cookie ab_sessao com os atributos e redirect /painel; o token resolve o gestor', async () => {
    const destino = await destinoDe(
      entrarAcao(ESTADO_INICIAL_ENTRAR, formulario({ email: a.gestor.email, senha: SENHA_DE_TESTE })),
    );
    expect(destino).toBe('/painel');
    expect(jar.gravacoes).toHaveLength(1);
    const [g] = jar.gravacoes;
    expect(g.nome).toBe('ab_sessao');
    expect(g.atributos).toEqual({ httpOnly: true, sameSite: 'lax', path: '/', secure: false, maxAge: TRINTA_DIAS_S });
    expect(g.atributos).not.toHaveProperty('domain');
    const ctx = await resolverTenant({ token: g.valor });
    expect([ctx.papel, ctx.salaoId]).toEqual(['gestor', a.salaoId]);
    const linha = await c.query('SELECT revogada_em FROM sessao WHERE token_hash = $1', [hashDoToken(g.valor)]);
    expect(linha.rows).toEqual([{ revogada_em: null }]);
  });

  it('CA-6: profissional → /painel; proximo válido é respeitado e o inválido vira /painel', async () => {
    expect(
      await destinoDe(entrarAcao(ESTADO_INICIAL_ENTRAR, formulario({ email: a.profissional.email, senha: SENHA_DE_TESTE }))),
    ).toBe('/painel');
    expect(
      await destinoDe(
        entrarAcao(
          ESTADO_INICIAL_ENTRAR,
          formulario({ email: a.gestor.email, senha: SENHA_DE_TESTE, proximo: '/painel/agenda?dia=2026-12-01' }),
        ),
      ),
    ).toBe('/painel/agenda?dia=2026-12-01');
    expect(
      await destinoDe(
        entrarAcao(ESTADO_INICIAL_ENTRAR, formulario({ email: a.gestor.email, senha: SENHA_DE_TESTE, proximo: '//evil.com' })),
      ),
    ).toBe('/painel');
  });

  it('falha: devolve o estado com a mensagem e o e-mail aparado, sem senha e sem cookie', async () => {
    const r = await entrarAcao(ESTADO_INICIAL_ENTRAR, formulario({ email: `  ${a.gestor.email} `, senha: 'errada' }));
    expect(r).toEqual({ mensagem: MENSAGENS_LOGIN.credenciais, erros: {}, email: a.gestor.email });
    expect(JSON.stringify(r)).not.toContain('errada');
    expect(jar.gravacoes).toEqual([]);
  });

  it('validação: erros por campo, mensagem nula; valores não-texto viram vazio; e-mail cortado em 254', async () => {
    const r = await entrarAcao(
      ESTADO_INICIAL_ENTRAR,
      formulario({ email: new Blob(['x']), senha: new Blob(['y']) }),
    );
    expect(r).toEqual({
      mensagem: null,
      erros: { email: MENSAGENS_LOGIN.emailVazio, senha: MENSAGENS_LOGIN.senhaVazia },
      email: '',
    });
    const longo = `${'a'.repeat(300)}@exemplo.com`;
    const r2 = await entrarAcao(ESTADO_INICIAL_ENTRAR, formulario({ email: longo, senha: 'x' }));
    expect(r2.email).toHaveLength(254);
    expect(r2.erros).toEqual({ email: MENSAGENS_LOGIN.emailVazio });
    expect(jar.gravacoes).toEqual([]);
  });
});

describe('CA-4 (casca): sairAcao revoga, apaga o cookie e redireciona', () => {
  it('CA-4: com cookie X → X revogada, cookie apagado (Max-Age 0, mesmos atributos) e redirect /entrar', async () => {
    const x = await entrarDeVerdade(a.gestor.email);
    const y = await entrarDeVerdade(a.gestor.email);
    jar.valor = x.token;
    expect(await destinoDe(sairAcao())).toBe('/entrar');
    expect(jar.gravacoes).toEqual([
      { nome: 'ab_sessao', valor: '', atributos: { httpOnly: true, sameSite: 'lax', path: '/', secure: false, maxAge: 0 } },
    ]);
    const r = await c.query('SELECT revogada_em FROM sessao WHERE token_hash = $1', [hashDoToken(x.token)]);
    expect(r.rows[0].revogada_em).not.toBeNull();
    // O cookie antigo não abre mais o painel; a outra sessão continua valendo.
    expect(await destinoDe(renderizarPainel())).toBe('/entrar?proximo=%2Fpainel');
    jar.valor = y.token;
    expect(await renderizarPainel()).toContain('Sair');
  });

  it('CA-4: sem cookie, repetido ou com token desconhecido → só apaga o cookie e redireciona', async () => {
    for (const valor of [undefined, 'token-desconhecido']) {
      jar.valor = valor;
      jar.gravacoes = [];
      expect(await destinoDe(sairAcao())).toBe('/entrar');
      expect(jar.gravacoes.map((g) => [g.valor, g.atributos.maxAge])).toEqual([['', 0]]);
    }
  });

  it('RN-22: o log do logout não traz o token', async () => {
    const linhas: string[] = [];
    vi.mocked(console.info).mockImplementation((l: string) => {
      linhas.push(l);
    });
    const x = await entrarDeVerdade(a.gestor.email);
    jar.valor = x.token;
    await destinoDe(sairAcao());
    expect(linhas.map((l) => JSON.parse(l).evento)).toEqual(['auth.logout']);
    expect(linhas.join('\n')).not.toContain(x.token);
    expect(linhas.join('\n')).not.toContain(hashDoToken(x.token));
  });
});

describe('CA-6 e CA-17: /painel com a sessão real', () => {
  it('CA-6: profissional vê a navegação do profissional, o nome do salão, o próprio nome e "Sair"', async () => {
    jar.valor = (await entrarDeVerdade(a.profissional.email)).token;
    const html = await renderizarPainel();
    expect(html).toContain(`Olá, ${a.profissional.nome}`);
    expect(html).toContain(a.nome);
    expect(html).toContain('>Agenda<');
    expect(html).toContain('>Bloqueios<');
    for (const soGestor of ['>Clientes<', '>Serviços<', '>Profissionais<', '>Configurações<', '>Assinatura<']) {
      expect(html).not.toContain(soGestor);
    }
    expect(html).toMatch(/<form[^>]*>.*Sair.*<\/form>/s);
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Sair<\/button>/);
  });

  it('CA-17: gestor de A vê a navegação completa e só o nome de A', async () => {
    jar.valor = (await entrarDeVerdade(a.gestor.email)).token;
    const html = await renderizarPainel();
    expect(html).toContain(a.nome);
    expect(html).toContain(`Olá, ${a.gestor.nome}`);
    expect(html).not.toContain(b.nome);
    expect(html).not.toContain(b.gestor.nome);
    for (const item of ['>Agenda<', '>Clientes<', '>Serviços<', '>Profissionais<', '>Bloqueios<', '>Configurações<', '>Assinatura<']) {
      expect(html).toContain(item);
    }
  });
});

describe('CA-10: auxiliar de página do painel', () => {
  it('CA-10: sem cookie, token desconhecido, sessão expirada ou revogada → redirect /entrar?proximo=%2Fpainel', async () => {
    const valores = [
      undefined,
      'token-desconhecido',
      (await criarSessao(a.gestor.usuarioId, { expiraEm: new Date(Date.now() - 1) })).token,
      (await criarSessao(a.gestor.usuarioId, { revogadaEm: new Date() })).token,
    ];
    for (const valor of valores) {
      jar.valor = valor;
      expect(await destinoDe(renderizarPainel())).toBe('/entrar?proximo=%2Fpainel');
    }
    expect(await destinoDe(exigirAcessoAoPainel('/painel/agenda'))).toBe('/entrar?proximo=%2Fpainel%2Fagenda');
  });

  it('CA-10: sessão de super admin → "Acesso negado" sem nome de salão nem dados', async () => {
    const admin = await criarSuperAdmin({ totpVerificado: true });
    jar.valor = admin.credencial!.token;
    const html = await renderizarPainel();
    expect(html).toContain('Acesso negado');
    expect(html).toContain('href="/entrar"');
    for (const dado of [a.nome, b.nome, 'Super admin de teste', 'Sair', 'Navegação do painel']) {
      expect(html).not.toContain(dado);
    }
  });

  it('CA-10: sessão de gestor → contexto do gestor; papel fora de `papeis` → negado', async () => {
    jar.valor = (await entrarDeVerdade(a.gestor.email)).token;
    const acesso = await exigirAcessoAoPainel('/painel');
    expect(acesso.tipo).toBe('permitido');
    expect(acesso.tipo === 'permitido' && { papel: acesso.ctx.papel, salaoId: acesso.ctx.salaoId }).toEqual({
      papel: 'gestor',
      salaoId: a.salaoId,
    });
    jar.valor = (await entrarDeVerdade(a.profissional.email)).token;
    expect(await exigirAcessoAoPainel('/painel/servicos', ['gestor'])).toEqual({ tipo: 'negado' });
  });

  it('erro de infraestrutura é relançado (não vira redirect nem negado)', async () => {
    jar.valor = 'qualquer';
    vi.stubEnv('DATABASE_URL', 'postgresql://usuario:senha@127.0.0.1:1/z');
    const erro = await exigirAcessoAoPainel('/painel').catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(Error);
    expect(erro).not.toBeInstanceOf(Redirecionado);
    await expect(destinoSeJaAutenticado(null)).rejects.toBeInstanceOf(Error);
  });
});

describe('CA-10: /entrar', () => {
  it('CA-10: com sessão válida → redirect /painel (ou o proximo válido)', async () => {
    jar.valor = (await entrarDeVerdade(a.gestor.email)).token;
    expect(await destinoDe(renderizarEntrar())).toBe('/painel');
    expect(await destinoDe(renderizarEntrar({ proximo: '/painel/agenda' }))).toBe('/painel/agenda');
    expect(await destinoDe(renderizarEntrar({ proximo: 'https://evil.com' }))).toBe('/painel');
  });

  it('CA-10: sem cookie, sessão inválida ou de super admin → mostra o formulário', async () => {
    const admin = await criarSuperAdmin({ totpVerificado: true });
    for (const valor of [undefined, 'token-desconhecido', admin.credencial!.token]) {
      jar.valor = valor;
      const html = await renderizarEntrar();
      expect(html).toContain('<h1>Entrar</h1>');
      expect(html).toMatch(/<input[^>]*type="email"/);
      expect(html).toMatch(/<input[^>]*type="password"/);
    }
  });

  it('sem cookie, /entrar não consulta o banco; proximo válido vira campo oculto, inválido não', async () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://usuario:senha@127.0.0.1:1/z');
    const comProximo = await renderizarEntrar({ proximo: '/painel/agenda' });
    expect(comProximo).toMatch(/<input[^>]*type="hidden"[^>]*name="proximo"[^>]*value="\/painel\/agenda"/);
    const buscas: Record<string, string | string[]>[] = [{ proximo: '//evil.com' }, { proximo: ['/painel', '/painel/x'] }, {}];
    for (const busca of buscas) {
      expect(await renderizarEntrar(busca)).not.toContain('name="proximo"');
    }
  });
});
