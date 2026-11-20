import type pg from 'pg';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import PaginaPainel from '@/app/painel/page';
import { salvarJornadaAcao } from '@/app/painel/profissionais/[id]/jornada/acoes';
import { ESTADO_INICIAL_FORMULARIO_JORNADA } from '@/app/painel/profissionais/[id]/jornada/estado';
import PaginaJornada from '@/app/painel/profissionais/[id]/jornada/page';
import PaginaProfissional from '@/app/painel/profissionais/[id]/page';
import { ROTAS } from '@/config/navegacao';
import { MENSAGENS_JORNADA } from '@/server/jornadas/tipos';

import { criarSessao, criarSuperAdmin } from '../../support/auth';
import { criarDoisSaloes, criarSalaoCompleto } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { conectar } from '../../support/sql';

import { UUID_INEXISTENTE, apagarJornada, faixasJornada, jornadaDoSalao } from './apoio';

// D-015 T-6: página e casca de /painel/profissionais/[id]/jornada com sessões reais no PostgreSQL.
// next/headers (cookies), next/navigation (redirect, notFound) e next/cache (revalidatePath) são
// substituídos (não é mock de banco). As páginas são renderizadas com renderToStaticMarkup.
// CA-1, CA-5, CA-11, CA-12, CA-14, CA-15, CA-16 e CA-18 (casca) na borda Next; links de acesso (D-9).

const M = MENSAGENS_JORNADA;

class Redirecionado extends Error {
  constructor(readonly destino: string) {
    super(`NEXT_REDIRECT ${destino}`);
  }
}
class NaoEncontradoNext extends Error {
  constructor() {
    super('NEXT_NOT_FOUND');
  }
}

const estadoNext = vi.hoisted(() => ({ cookie: undefined as string | undefined, revalidados: [] as string[] }));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (nome: string) =>
      nome === 'ab_sessao' && estadoNext.cookie !== undefined ? { name: nome, value: estadoNext.cookie } : undefined,
  }),
}));
vi.mock('next/navigation', () => ({
  redirect: (destino: string) => {
    throw new Redirecionado(destino);
  },
  notFound: () => {
    throw new NaoEncontradoNext();
  },
  usePathname: () => null,
}));
vi.mock('next/cache', () => ({
  revalidatePath: (caminho: string) => {
    estadoNext.revalidados.push(caminho);
  },
}));

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
  estadoNext.cookie = undefined;
  estadoNext.revalidados = [];
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

async function comoGestor(s: SalaoCompleto): Promise<void> {
  estadoNext.cookie = (await criarSessao(s.gestor.usuarioId)).token;
}
async function comoProfissional(s: SalaoCompleto): Promise<void> {
  estadoNext.cookie = (await criarSessao(s.profissional.usuarioId)).token;
}

async function falhaDe(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    () => {
      throw new Error('esperava redirect ou notFound');
    },
    (e: unknown) => e,
  );
}
async function destinoDe(p: Promise<unknown>): Promise<string> {
  const e = await falhaDe(p);
  expect(e).toBeInstanceOf(Redirecionado);
  return (e as Redirecionado).destino;
}

const jornada = async (id: string, salva?: string) =>
  renderToStaticMarkup(
    await PaginaJornada({ params: Promise.resolve({ id }), searchParams: Promise.resolve(salva ? { salva } : {}) }),
  );
const paginaProfissional = async (id: string) => renderToStaticMarkup(await PaginaProfissional({ params: Promise.resolve({ id }) }));
const painel = async () => renderToStaticMarkup(await PaginaPainel());

/** FormData do formulário: profissionalId + campos `inicio-<dia>-<n>`/`fim-<dia>-<n>`. */
function formulario(profissionalId: string | undefined, linhas: Record<string, string> = {}, extras: Record<string, string> = {}): FormData {
  const f = new FormData();
  if (profissionalId !== undefined) f.set('profissionalId', profissionalId);
  for (const [k, v] of Object.entries({ ...linhas, ...extras })) f.set(k, v);
  return f;
}

async function novoProfissional(s: SalaoCompleto, ativo = true): Promise<string> {
  const { rows } = await c.query<{ id: string }>(
    "INSERT INTO profissional (salao_id, nome, ativo) VALUES ($1, 'Pessoa Nova', $2) RETURNING id::text AS id",
    [s.salaoId, ativo],
  );
  return rows[0].id;
}

describe('página: gestor', () => {
  it('CA-1/CA-18: a casca grava segunda 09–12 e 13–18 → PRG ?salva=1; a página mostra a pausa, os valores e a folga', async () => {
    const s = await criarSalaoCompleto();
    const id = await novoProfissional(s);
    await comoGestor(s);
    const destino = await destinoDe(
      salvarJornadaAcao(
        ESTADO_INICIAL_FORMULARIO_JORNADA,
        formulario(id, { 'inicio-1-0': '09:00', 'fim-1-0': '12:00', 'inicio-1-1': '13:00', 'fim-1-1': '18:00' }),
      ),
    );
    expect(destino).toBe(`${ROTAS.jornada(id)}?salva=1`);
    expect(estadoNext.revalidados).toEqual([ROTAS.jornada(id)]);
    expect(await faixasJornada(c, id)).toEqual([
      [1, 540, 720],
      [1, 780, 1080],
    ]);

    const html = await jornada(id, '1');
    expect(html).toContain('<h1>Jornada de Pessoa Nova</h1>');
    expect(html).toContain('09:00–12:00, 13:00–18:00 · Pausa 12:00–13:00');
    expect((html.match(/>Folga</g) ?? []).length).toBe(6);
    expect(html).toContain('name="inicio-1-0"');
    expect(html).toMatch(/name="fim-1-1"[^>]*value="18:00"|value="18:00"[^>]*name="fim-1-1"/);
    expect(html).toContain(`name="profissionalId" value="${id}"`);
    expect(html).toContain('Salvar jornada');
    expect(html).toContain(M.salva);
    expect(html).toContain(`href="${ROTAS.profissional(id)}"`);
    expect(html).toContain('aria-current="page"');
    expect(html).not.toContain(M.semIntervalos);
    expect(html).not.toContain(M.inativo);
    // Sem ?salva=1 não há a mensagem de sucesso.
    expect(await jornada(id)).not.toContain(M.salva);
  });

  it('CA-18: até 6 intervalos num dia pelo formulário sem JS são gravados', async () => {
    const s = await criarSalaoCompleto();
    const id = await novoProfissional(s);
    await comoGestor(s);
    const linhas: Record<string, string> = {};
    [8, 10, 12, 14, 16, 18].forEach((h, n) => {
      linhas[`inicio-2-${n}`] = `${h}:00`;
      linhas[`fim-2-${n}`] = `${h}:30`;
    });
    expect(await destinoDe(salvarJornadaAcao(ESTADO_INICIAL_FORMULARIO_JORNADA, formulario(id, linhas)))).toBe(`${ROTAS.jornada(id)}?salva=1`);
    expect(await faixasJornada(c, id)).toHaveLength(6);
  });

  it('CA-5/CA-16: 22:00–24:00 exibido como 24:00; salão em America/Manaus mostra 09:00 sem conversão', async () => {
    const s = await criarSalaoCompleto({ salao: { fuso: 'America/Manaus' } });
    const id = s.profissional.profissionalId;
    await comoGestor(s);
    await destinoDe(
      salvarJornadaAcao(
        ESTADO_INICIAL_FORMULARIO_JORNADA,
        formulario(id, { 'inicio-1-0': '9:00', 'fim-1-0': '12:00', 'inicio-5-0': '22:00', 'fim-5-0': '24:00' }),
      ),
    );
    expect(await faixasJornada(c, id)).toEqual([
      [1, 540, 720],
      [5, 1320, 1440],
    ]);
    const html = await jornada(id);
    expect(html).toContain('22:00–24:00');
    expect(html).toContain('value="24:00"');
    expect(html).toContain('value="09:00"');
    expect(html).toContain('>09:00–12:00<');
  });

  it('CA-14/CA-15: inativo sem jornada → avisos de inativo e de sem horários; tudo folga', async () => {
    const s = await criarSalaoCompleto();
    await comoGestor(s);
    const html = await jornada(s.profissionalInativoId);
    expect(html).toContain(M.inativo);
    expect(html).toContain(M.semIntervalos);
    expect((html.match(/>Folga</g) ?? []).length).toBe(7);
    expect(html).toContain('Salvar jornada');
  });

  it('CA-11: id de B, inexistente ou malformado → notFound', async () => {
    await comoGestor(a);
    for (const id of [b.profissional.profissionalId, UUID_INEXISTENTE, 'abc']) {
      expect(await falhaDe(jornada(id)), id).toBeInstanceOf(NaoEncontradoNext);
    }
  });

  it('a página do profissional tem a seção "Jornada" com o link', async () => {
    await comoGestor(a);
    const html = await paginaProfissional(a.profissional.profissionalId);
    expect(html).toContain('<h2 id="jornada-profissional">Jornada</h2>');
    expect(html).toContain(`href="${ROTAS.jornada(a.profissional.profissionalId)}">Ver e editar a jornada</a>`);
  });
});

describe('CA-12: página para o profissional, super admin e sem sessão', () => {
  it('CA-12: o profissional vê a própria jornada somente leitura (sem campos nem botão salvar)', async () => {
    await comoProfissional(a);
    const html = await jornada(a.profissional.profissionalId);
    expect(html).toContain(`<h1>Jornada de ${a.profissional.nome}</h1>`);
    expect(html).toContain(M.somenteLeitura);
    expect(html).toContain('<dt>Segunda-feira</dt>');
    expect(html).toContain('>09:00–12:00, 13:00–18:00<');
    expect(html).toContain('>Pausa 12:00–13:00<');
    expect(html).not.toContain('Salvar jornada');
    expect(html).not.toMatch(/<input[^>]*name="(inicio|fim|profissionalId)/);
    expect(html).not.toContain(`href="${ROTAS.profissional(a.profissional.profissionalId)}"`);
  });

  it('CA-15: o profissional sem nenhum intervalo vê o aviso e tudo como folga', async () => {
    const s = await criarSalaoCompleto();
    await apagarJornada(c, s.profissional.profissionalId);
    await comoProfissional(s);
    const html = await jornada(s.profissional.profissionalId);
    expect(html).toContain(M.semIntervalos);
    expect((html.match(/>Folga</g) ?? []).length).toBe(7);
  });

  it('CA-12: outro profissional do mesmo salão → "Acesso negado"; outro salão, inexistente ou malformado → notFound', async () => {
    await comoProfissional(a);
    for (const id of [a.gestor.profissionalId!, a.profissionalInativoId]) {
      const html = await jornada(id);
      expect(html).toContain('Acesso negado');
      expect(html).not.toContain(a.gestor.nome);
    }
    for (const id of [b.profissional.profissionalId, UUID_INEXISTENTE, 'abc']) {
      expect(await falhaDe(jornada(id)), id).toBeInstanceOf(NaoEncontradoNext);
    }
  });

  it('super admin → "Acesso negado"; sem cookie → /entrar?proximo=<rota da jornada>', async () => {
    const admin = await criarSuperAdmin({ totpVerificado: true });
    estadoNext.cookie = admin.credencial!.token;
    expect(await jornada(a.profissional.profissionalId)).toContain('Acesso negado');
    estadoNext.cookie = undefined;
    expect(await destinoDe(jornada('abc'))).toBe('/entrar?proximo=%2Fpainel%2Fprofissionais%2Fabc%2Fjornada');
  });
});

describe('D-9: "Minha jornada" em /painel', () => {
  it('profissional e gestor que atende veem o link para a própria jornada; gestor sem perfil não', async () => {
    await comoProfissional(a);
    expect(await painel()).toContain(`href="${ROTAS.jornada(a.profissional.profissionalId)}">Minha jornada</a>`);
    await comoGestor(a);
    expect(await painel()).toContain(`href="${ROTAS.jornada(a.gestor.profissionalId!)}">Minha jornada</a>`);
    const semPerfil = await criarSalaoCompleto({ gestor: { comPerfil: false } });
    await comoGestor(semPerfil);
    expect(await painel()).not.toContain('Minha jornada');
  });
});

describe('casca acoes.ts', () => {
  it('CA-2/R-7: inválido → erros por dia e linha e valores preservados (cortados); nada gravado', async () => {
    await comoGestor(a);
    const id = a.profissional.profissionalId;
    const antes = await jornadaDoSalao(c, a.salaoId);
    const r = await salvarJornadaAcao(
      ESTADO_INICIAL_FORMULARIO_JORNADA,
      formulario(id, { 'inicio-1-0': '09:00', 'fim-1-0': '12:00', 'inicio-1-1': '11:00', 'fim-1-1': '14:00', 'inicio-3-0': '1'.repeat(40) }),
    );
    expect(r.mensagem).toBeNull();
    expect(r.erros).toEqual({
      dias: {
        1: { intervalos: { 0: { intervalo: M.sobreposicao }, 1: { intervalo: M.sobreposicao } } },
        3: { intervalos: { 0: { inicio: M.formato, fim: M.faltaFim } } },
      },
    });
    expect(r.valores![1].slice(0, 2)).toEqual([
      { inicio: '09:00', fim: '12:00' },
      { inicio: '11:00', fim: '14:00' },
    ]);
    expect(r.valores![3][0]).toEqual({ inicio: '1'.repeat(10), fim: '' });
    expect(Object.values(r.valores!).every((linhas) => linhas.length === 6)).toBe(true);
    expect(estadoNext.revalidados).toEqual([]);
    expect(await jornadaDoSalao(c, a.salaoId)).toEqual(antes);
  });

  it('CA-11: campos extras (salaoId, linha 7, dia 7) são ignorados; o alvo continua o do campo oculto', async () => {
    const s = await criarSalaoCompleto();
    const id = await novoProfissional(s);
    await comoGestor(s);
    const antesB = await jornadaDoSalao(c, b.salaoId);
    await destinoDe(
      salvarJornadaAcao(
        ESTADO_INICIAL_FORMULARIO_JORNADA,
        formulario(id, { 'inicio-0-0': '10:00', 'fim-0-0': '11:00' }, { salaoId: b.salaoId, 'inicio-0-6': '12:00', 'fim-0-6': '13:00', 'inicio-7-0': '08:00', 'fim-7-0': '09:00' }),
      ),
    );
    expect(await faixasJornada(c, id)).toEqual([[0, 600, 660]]);
    expect(await jornadaDoSalao(c, b.salaoId)).toEqual(antesB);
  });

  it('CA-11/CA-3: id de B → "não encontrado"; profissional → "acesso negado"; sem profissionalId → formulario', async () => {
    await comoGestor(a);
    const linhas = { 'inicio-1-0': '10:00', 'fim-1-0': '11:00' };
    const antesB = await jornadaDoSalao(c, b.salaoId);
    const r = await salvarJornadaAcao(ESTADO_INICIAL_FORMULARIO_JORNADA, formulario(b.profissional.profissionalId, linhas));
    expect(r).toMatchObject({ mensagem: M.naoEncontrado, erros: {} });
    expect(r.valores![1][0]).toEqual({ inicio: '10:00', fim: '11:00' });
    expect(await jornadaDoSalao(c, b.salaoId)).toEqual(antesB);
    expect((await salvarJornadaAcao(ESTADO_INICIAL_FORMULARIO_JORNADA, formulario(undefined, linhas))).erros).toEqual({ formulario: M.formulario });

    await comoProfissional(a);
    const antesA = await jornadaDoSalao(c, a.salaoId);
    expect(
      (await salvarJornadaAcao(ESTADO_INICIAL_FORMULARIO_JORNADA, formulario(a.profissional.profissionalId, linhas))).mensagem,
    ).toBe(M.acessoNegado);
    expect(await jornadaDoSalao(c, a.salaoId)).toEqual(antesA);
  });

  it('nao_autenticado → /entrar com a rota da jornada (ou a lista sem id)', async () => {
    const id = a.profissional.profissionalId;
    expect(await destinoDe(salvarJornadaAcao(ESTADO_INICIAL_FORMULARIO_JORNADA, formulario(id)))).toBe(
      `/entrar?proximo=${encodeURIComponent(ROTAS.jornada(id))}`,
    );
    expect(await destinoDe(salvarJornadaAcao(ESTADO_INICIAL_FORMULARIO_JORNADA, formulario(undefined)))).toBe(
      '/entrar?proximo=%2Fpainel%2Fprofissionais',
    );
  });
});
