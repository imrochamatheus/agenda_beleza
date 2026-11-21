import type pg from 'pg';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as rotaEnvio from '@/app/api/painel/fotos/route';
import { GET as servir } from '@/app/api/fotos/[id]/route';
import { editarAltAcao, moverAcao, removerAcao } from '@/app/painel/configuracoes/fotos/acoes';
import PaginaFotos from '@/app/painel/configuracoes/fotos/page';
import PaginaConfiguracoes from '@/app/painel/configuracoes/page';
import { ROTAS, SEGMENTOS_RESERVADOS } from '@/config/navegacao';
import { CODIGOS_ACAO, CODIGOS_ENVIO, MENSAGENS_ACAO, MENSAGENS_FOTO } from '@/server/fotos/tipos';

import { criarSessao } from '../../support/auth';
import { criarDoisSaloes } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { jpegPequeno } from '../../support/imagens';
import { conectar } from '../../support/sql';

import { criarFotos, fotosDe, inserirFoto } from './apoio';
import { APP_URL, encerrarArmazenamento, prepararArmazenamento, requisicaoDeEnvio } from './apoio-servico';
import type { Armazenamento } from './apoio-servico';

// D-021 T-10: página, cascas e route handlers com sessões reais no PostgreSQL. next/headers,
// next/navigation e next/cache são substituídos (não é mock de banco). CA-4 (página), CA-12 (códigos na
// página), CA-14 (rota chama a ação), CA-16.

class Redirecionado extends Error {
  constructor(readonly destino: string) {
    super(`NEXT_REDIRECT ${destino}`);
  }
}

const estadoNext = vi.hoisted(() => ({ cookie: undefined as string | undefined, revalidados: [] as string[] }));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (nome: string) => (nome === 'ab_sessao' && estadoNext.cookie !== undefined ? { name: nome, value: estadoNext.cookie } : undefined),
  }),
}));
vi.mock('next/navigation', () => ({
  redirect: (destino: string) => {
    throw new Redirecionado(destino);
  },
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
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
let arm: Armazenamento;

beforeAll(async () => {
  c = await conectar();
  ({ a, b } = await criarDoisSaloes());
  arm = prepararArmazenamento();
});
afterAll(async () => {
  encerrarArmazenamento(arm);
  await c.end();
});
beforeEach(() => {
  estadoNext.cookie = undefined;
  estadoNext.revalidados = [];
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(async () => {
  await c.query('DELETE FROM salao_foto WHERE salao_id IN ($1, $2)', [a.salaoId, b.salaoId]);
  arm.limpar();
  vi.restoreAllMocks();
});

const como = async (usuarioId: string) => {
  estadoNext.cookie = (await criarSessao(usuarioId)).token;
};
const comoGestor = (s: SalaoCompleto) => como(s.gestor.usuarioId);

async function destinoDe(p: Promise<unknown>): Promise<string> {
  const e = await p.then(
    () => {
      throw new Error('esperava redirect');
    },
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(Redirecionado);
  return (e as Redirecionado).destino;
}

const pagina = async (params: Record<string, string> = {}) => renderToStaticMarkup(await PaginaFotos({ searchParams: Promise.resolve(params) }));
const itemAtual = (html: string) => html.match(/<a[^>]*aria-current="page"[^>]*>([^<]*)<\/a>/)?.[0] ?? '';
const form = (campos: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.append(k, v);
  return f;
};

describe('página /painel/configuracoes/fotos (CA-4, CA-16)', () => {
  it('o gestor vê o contador, as fotos na ordem, o aviso de privacidade e "Configurações" como item atual', async () => {
    await criarFotos(c, a.salaoId, 3);
    await inserirFoto(c, b.salaoId);
    await comoGestor(a);
    const html = await pagina();
    expect(html).toContain('3 de 12 fotos');
    expect(html).toContain('metadados da imagem, inclusive a localização');
    expect(html).toContain('action="/api/painel/fotos"');
    expect(html).toMatch(/enc[tT]ype="multipart\/form-data"/);
    expect(html.indexOf('Foto 1 de 3')).toBeLessThan(html.indexOf('Foto 3 de 3'));
    expect(html).not.toContain('Foto 1 de 1');
    expect(itemAtual(html)).toContain(`href="${ROTAS.configuracoes}"`);
    expect(html).not.toContain('referrer');
  });

  it('cada renderização gera um token de envio novo (UUID)', async () => {
    await comoGestor(a);
    const token = (h: string) => h.match(/name="envio" value="([^"]+)"/)![1];
    const t1 = token(await pagina());
    const t2 = token(await pagina());
    expect(t1).toMatch(/^[0-9a-f-]{36}$/);
    expect(t1).not.toBe(t2);
  });

  it('com 12 fotos o formulário é substituído pelo aviso do limite', async () => {
    await criarFotos(c, a.salaoId, 12);
    await comoGestor(a);
    const html = await pagina();
    expect(html).toContain('12 de 12 fotos');
    expect(html).not.toContain('name="foto"');
    expect(html).toContain(MENSAGENS_FOTO.limite);
  });

  it('profissional vê "Acesso negado" e nenhuma foto; sem sessão redireciona para /entrar?proximo=', async () => {
    await criarFotos(c, a.salaoId, 1);
    await como(a.profissional.usuarioId);
    const negado = await pagina();
    expect(negado).toContain('Acesso negado');
    expect(negado).not.toContain('/api/fotos/');
    estadoNext.cookie = undefined;
    expect(await destinoDe(pagina())).toBe('/entrar?proximo=%2Fpainel%2Fconfiguracoes%2Ffotos');
  });

  it('o gestor que também é profissional tem o mesmo acesso', async () => {
    await comoGestor(a);
    expect(a.gestor.profissionalId).not.toBeNull();
    expect(await pagina()).toContain('Fotos do salão');
  });

  it('cada código de envio mostra a mensagem pt-BR; valor desconhecido não mostra nada nem quebra', async () => {
    await comoGestor(a);
    for (const codigo of CODIGOS_ENVIO) {
      const html = await pagina({ envio: codigo });
      expect(html, codigo).toContain(MENSAGENS_FOTO[codigo].replace(/'/g, '&#x27;'));
      expect(html).toContain('id="resultado-fotos"');
    }
    for (const ruim of ['<script>alert(1)</script>', 'desconhecido', '', 'OK']) {
      const html = await pagina({ envio: ruim });
      expect(html).not.toContain('resultado-fotos');
      expect(html).not.toContain('<script>alert');
    }
  });

  it('cada código de ação (?acao=) mostra a mensagem; desconhecido não mostra nada', async () => {
    await comoGestor(a);
    for (const codigo of CODIGOS_ACAO) {
      expect(await pagina({ acao: codigo }), codigo).toContain(MENSAGENS_ACAO[codigo]);
    }
    expect(await pagina({ acao: 'xyz' })).not.toContain('resultado-fotos');
  });

  it('/painel/configuracoes tem o link "Fotos do salão" com a ajuda', async () => {
    await comoGestor(a);
    const html = renderToStaticMarkup(await PaginaConfiguracoes());
    expect(html).toContain(`href="${ROTAS.configuracoesFotos}"`);
    expect(html).toContain('Fotos do salão');
    expect(html).toContain('Até 12 fotos exibidas na página pública.');
  });

  it('SEGMENTOS_RESERVADOS já cobre os primeiros segmentos das rotas novas', () => {
    for (const rota of [ROTAS.configuracoesFotos, ROTAS.envioFotos, ROTAS.devFotos, ROTAS.devFotosEnvio]) {
      expect(SEGMENTOS_RESERVADOS.has(rota.split('/')[1])).toBe(true);
    }
  });
});

describe('cascas das ações (PRG)', () => {
  it('editar a descrição: ok, inválido (vazio e longo), de outro salão e sem sessão', async () => {
    const [f] = await criarFotos(c, a.salaoId, 1);
    const fb = await inserirFoto(c, b.salaoId);
    await comoGestor(a);
    expect(await destinoDe(editarAltAcao(form({ fotoId: f.id, alt: ' Novo   texto ' })))).toBe('/painel/configuracoes/fotos?acao=alt_ok');
    expect((await fotosDe(c, a.salaoId))[0].alt).toBe('Novo texto');
    expect(estadoNext.revalidados).toContain(ROTAS.configuracoesFotos);
    expect(await destinoDe(editarAltAcao(form({ fotoId: f.id, alt: '' })))).toBe('/painel/configuracoes/fotos?acao=alt_vazio');
    expect(await destinoDe(editarAltAcao(form({ fotoId: f.id, alt: 'a'.repeat(151) })))).toBe('/painel/configuracoes/fotos?acao=alt_longo');
    expect(await destinoDe(editarAltAcao(form({ fotoId: fb.id, alt: 'invasão' })))).toBe('/painel/configuracoes/fotos?acao=nao_encontrada');
    expect(await destinoDe(editarAltAcao(form({ alt: 'x' })))).toBe('/painel/configuracoes/fotos?acao=nao_encontrada');
    estadoNext.cookie = undefined;
    expect(await destinoDe(editarAltAcao(form({ fotoId: f.id, alt: 'x' })))).toBe('/entrar?proximo=%2Fpainel%2Fconfiguracoes%2Ffotos');
    await como(a.profissional.usuarioId);
    expect(await destinoDe(editarAltAcao(form({ fotoId: f.id, alt: 'x' })))).toBe('/painel/configuracoes/fotos?acao=negado');
  });

  it('mover: movida, ordem_mudou, na_ponta; remover: removida e depois nao_encontrada', async () => {
    const [f1, f2] = await criarFotos(c, a.salaoId, 2);
    await comoGestor(a);
    expect(await destinoDe(moverAcao(form({ fotoId: f2.id, direcao: 'cima', posicaoEsperada: '2' })))).toBe('/painel/configuracoes/fotos?acao=movida');
    expect((await fotosDe(c, a.salaoId)).map((f) => f.id)).toEqual([f2.id, f1.id]);
    expect(await destinoDe(moverAcao(form({ fotoId: f2.id, direcao: 'cima', posicaoEsperada: '2' })))).toBe('/painel/configuracoes/fotos?acao=ordem_mudou');
    expect(await destinoDe(moverAcao(form({ fotoId: f2.id, direcao: 'cima', posicaoEsperada: '1' })))).toBe('/painel/configuracoes/fotos?acao=na_ponta');
    expect(await destinoDe(removerAcao(form({ fotoId: f2.id })))).toBe('/painel/configuracoes/fotos?acao=removida');
    expect(await destinoDe(removerAcao(form({ fotoId: f2.id })))).toBe('/painel/configuracoes/fotos?acao=nao_encontrada');
    estadoNext.cookie = undefined;
    expect(await destinoDe(moverAcao(form({ fotoId: f1.id, direcao: 'cima', posicaoEsperada: '1' })))).toContain('/entrar?proximo=');
    expect(await destinoDe(removerAcao(form({ fotoId: f1.id })))).toContain('/entrar?proximo=');
  });
});

describe('route handlers (CA-12, CA-14, A-3)', () => {
  it('POST /api/painel/fotos chama a ação de envio com a sessão do cookie e responde 303', async () => {
    await comoGestor(a);
    const r = await rotaEnvio.POST(await requisicaoDeEnvio({ arquivo: await jpegPequeno(), alt: 'Pela rota' }));
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toBe('/painel/configuracoes/fotos?envio=ok');
    expect((await fotosDe(c, a.salaoId)).map((f) => f.alt)).toEqual(['Pela rota']);
    // Origin de outro host: 403 mesmo com sessão válida
    const forjada = await rotaEnvio.POST(await requisicaoDeEnvio({ arquivo: await jpegPequeno() }, 'https://atacante.test'));
    expect(forjada.status).toBe(403);
    expect(await fotosDe(c, a.salaoId)).toHaveLength(1);
  });

  it('sem cookie o POST redireciona para /entrar; GET, HEAD, PUT, PATCH e DELETE → 405', async () => {
    const r = await rotaEnvio.POST(await requisicaoDeEnvio({ arquivo: await jpegPequeno() }));
    expect(r.headers.get('location')).toBe('/entrar?proximo=%2Fpainel%2Fconfiguracoes%2Ffotos');
    for (const m of [rotaEnvio.GET, rotaEnvio.HEAD, rotaEnvio.PUT, rotaEnvio.PATCH, rotaEnvio.DELETE]) {
      const resp = m();
      expect(resp.status).toBe(405);
      expect(resp.headers.get('allow')).toBe('POST');
    }
  });

  it('GET /api/fotos/[id] serve a foto e dá 404 para id ruim; o APP_URL de teste é o esperado', async () => {
    await comoGestor(a);
    await rotaEnvio.POST(await requisicaoDeEnvio({ arquivo: await jpegPequeno() }));
    const [f] = await fotosDe(c, a.salaoId);
    estadoNext.cookie = undefined;
    const ok = await servir(new Request(`${APP_URL}/api/fotos/${f.id}`), { params: Promise.resolve({ id: f.id }) });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toBe('image/webp');
    const ruim = await servir(new Request(`${APP_URL}/api/fotos/x`), { params: Promise.resolve({ id: 'x' }) });
    expect(ruim.status).toBe(404);
  });
});
