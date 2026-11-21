import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import type pg from 'pg';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import PaginaDoSalao from '@/app/(publico)/[slug]/page';
import PaginaAvaliar, { metadata } from '@/app/(publico)/[slug]/avaliar/[token]/page';
import { avaliarAcao } from '@/app/(publico)/[slug]/avaliar/[token]/acoes';
import { ESTADO_INICIAL_AVALIACAO } from '@/app/(publico)/[slug]/avaliar/[token]/estado';
import { MENSAGEM_LINK_INVALIDO, MENSAGENS_AVALIACAO } from '@/server/avaliacoes/tipos';
import { ROTAS } from '@/config/navegacao';
import { TOKEN_TURNSTILE_SIMULADO } from '@/server/integrations/turnstile/port';

import nextConfig from '../../../next.config';
import { conectar } from '../../support/sql';

import { criarAvaliavel, emitirLink, enviar, salaoNovo } from './apoio';
import type { SalaoCompleto } from '../../support/factories';

// D-032 T-6: casca Next da rota /{slug}/avaliar/[token] com PostgreSQL real (next/headers substituído; o
// banco não). CA-4/CA-5 pela rota, CA-13/CA-6 pela ação, uniformidade da página, cabeçalhos do next.config.

const estadoNext = vi.hoisted(() => ({ xff: undefined as string | undefined }));
vi.mock('next/headers', () => ({
  headers: async () => new Headers(estadoNext.xff === undefined ? {} : { 'x-forwarded-for': estadoNext.xff }),
}));

let c: pg.Client;
let s: SalaoCompleto;
let seq = 0;

beforeAll(async () => {
  c = await conectar();
  s = await salaoNovo();
});
afterAll(async () => {
  await c.end();
});
beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  // Com TRUSTED_PROXY_HOPS=0 todo IP é "desconhecido"; um IP novo por caso evita dividir a cota.
  vi.stubEnv('TRUSTED_PROXY_HOPS', '1');
  estadoNext.xff = `203.0.113.${(seq += 1)}`;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const renderizar = async (slug: string, token: string) =>
  renderToStaticMarkup(await PaginaAvaliar({ params: Promise.resolve({ slug, token }) }));

function formulario(campos: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
}

describe('página (GET)', () => {
  it('link válido: formulário com o nome do salão, token só no campo oculto, sem dados da reserva', async () => {
    const k = await criarAvaliavel(c, s, { nome: 'Cliente Secreta' });
    const { token } = await emitirLink(s, k.reservaId, new Date());
    const html = await renderizar(s.slugAtual, token);
    expect(html).toContain(`Avalie ${s.nome}`);
    expect(html).toContain(`name="token" value="${token}"`);
    expect(html).toContain('name="nota"');
    expect(html).toContain('name="aceite_publicacao"');
    expect(html).toContain('Autorizo a publicação da minha avaliação');
    expect(html).not.toContain('Cliente Secreta');
    expect(html).not.toContain(k.telefone);
    expect(html).not.toContain(MENSAGEM_LINK_INVALIDO);
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it('tudo que não vale responde o MESMO corpo (sem o token no HTML) e nunca 404', async () => {
    const k = await criarAvaliavel(c, s);
    const { token } = await emitirLink(s, k.reservaId, new Date());
    const casos: [string, string][] = [
      [s.slugAtual, 'curto'],
      [s.slugAtual, 'a'.repeat(43)],
      ['nao-existe-mesmo', token],
      ['../x', token],
      [s.slugAtual, `${token.slice(0, 42)}${token.endsWith('A') ? 'B' : 'A'}`],
    ];
    const corpos = new Set<string>();
    for (const [slug, tk] of casos) {
      const html = await renderizar(slug, tk);
      expect(html).toContain(MENSAGEM_LINK_INVALIDO);
      expect(html).not.toContain('name="token"');
      corpos.add(html.replaceAll(slug, '{slug}'));
    }
    expect(corpos.size).toBe(1);
  });

  it('limite por IP excedido: mensagem genérica, sem formulário', async () => {
    estadoNext.xff = '203.0.113.250';
    vi.stubEnv('PROTECAO_LIMITE_IP_AVALIACAO', '1');
    const k = await criarAvaliavel(c, s);
    const { token } = await emitirLink(s, k.reservaId, new Date());
    await renderizar(s.slugAtual, token);
    const html = await renderizar(s.slugAtual, token);
    expect(html).toContain(MENSAGENS_AVALIACAO.limitado);
    expect(html).not.toContain('name="token"');
  });
});

describe('ação (POST)', () => {
  it('envia a avaliação pelo shell e devolve o estado de sucesso; o link some', async () => {
    const k = await criarAvaliavel(c, s);
    const { token } = await emitirLink(s, k.reservaId, new Date());
    const estado = await avaliarAcao(
      ESTADO_INICIAL_AVALIACAO,
      formulario({ slug: s.slugAtual, token, nota: '5', comentario: 'Perfeito', aceite_publicacao: 'on', 'cf-turnstile-response': TOKEN_TURNSTILE_SIMULADO }),
    );
    expect(estado).toMatchObject({ status: 'enviada', mensagem: MENSAGENS_AVALIACAO.enviada, erros: {} });
    const { rows } = await c.query('SELECT nota, comentario FROM avaliacao WHERE reserva_id = $1', [k.reservaId]);
    expect(rows).toEqual([{ nota: 5, comentario: 'Perfeito' }]);
    // Sem JS a página é renderizada de novo: o link já foi usado e a resposta é a uniforme.
    expect(await renderizar(s.slugAtual, token)).toContain(MENSAGEM_LINK_INVALIDO);
  });

  it('erros de campo preservam os valores; o link segue válido', async () => {
    const k = await criarAvaliavel(c, s);
    const { token } = await emitirLink(s, k.reservaId, new Date());
    const estado = await avaliarAcao(
      ESTADO_INICIAL_AVALIACAO,
      formulario({ slug: s.slugAtual, token, nota: '', comentario: '  quase  ', 'cf-turnstile-response': TOKEN_TURNSTILE_SIMULADO }),
    );
    expect(estado.status).toBe('editando');
    expect(estado.erros).toEqual({ nota: MENSAGENS_AVALIACAO.nota, aceite: MENSAGENS_AVALIACAO.aceite });
    expect(estado.valores).toEqual({ nota: '', comentario: '  quase  ', aceite: false });
    expect((await c.query('SELECT 1 FROM avaliacao WHERE reserva_id = $1', [k.reservaId])).rowCount).toBe(0);
  });

  it('sem token de verificação humana: mensagem, nada gravado', async () => {
    const k = await criarAvaliavel(c, s);
    const { token } = await emitirLink(s, k.reservaId, new Date());
    const estado = await avaliarAcao(ESTADO_INICIAL_AVALIACAO, formulario({ slug: s.slugAtual, token, nota: '5', aceite_publicacao: 'on' }));
    expect(estado).toMatchObject({ status: 'editando', mensagem: MENSAGENS_AVALIACAO.humano });
    expect((await c.query('SELECT 1 FROM avaliacao WHERE reserva_id = $1', [k.reservaId])).rowCount).toBe(0);
  });

  it('link inválido: estado `invalido` com a mensagem uniforme', async () => {
    const estado = await avaliarAcao(
      ESTADO_INICIAL_AVALIACAO,
      formulario({ slug: s.slugAtual, token: 'x'.repeat(43), nota: '5', aceite_publicacao: 'on', 'cf-turnstile-response': TOKEN_TURNSTILE_SIMULADO }),
    );
    expect(estado).toMatchObject({ status: 'invalido', mensagem: MENSAGEM_LINK_INVALIDO });
  });

  it('limite por IP excedido: estado `limitado`', async () => {
    estadoNext.xff = '203.0.113.251';
    vi.stubEnv('PROTECAO_LIMITE_IP_AVALIACAO', '1');
    const f = () => formulario({ slug: s.slugAtual, token: 'x'.repeat(43), nota: '5', aceite_publicacao: 'on', 'cf-turnstile-response': TOKEN_TURNSTILE_SIMULADO });
    await avaliarAcao(ESTADO_INICIAL_AVALIACAO, f());
    expect(await avaliarAcao(ESTADO_INICIAL_AVALIACAO, f())).toMatchObject({ status: 'limitado', mensagem: MENSAGENS_AVALIACAO.limitado });
  });
});

describe('página pública do salão (CA-3, CA-14, CA-15)', () => {
  const pagina = async (slug: string) =>
    renderToStaticMarkup(await PaginaDoSalao({ params: Promise.resolve({ slug }), searchParams: Promise.resolve({}) }));

  it('sem avaliações: "Ainda sem avaliações"; com avaliação: média, contagem, nome e comentário escapado', async () => {
    const t = await salaoNovo();
    expect(await pagina(t.slugAtual)).toContain('Ainda sem avaliações');
    const k = await criarAvaliavel(c, t, { nome: 'Carla Dias' });
    const { token } = await emitirLink(t, k.reservaId, new Date());
    expect(await enviar(t, token, { nota: '4', comentario: '<script>x()</script> ótimo' }, new Date())).toEqual({ resultado: 'enviada' });
    const html = await pagina(t.slugAtual);
    expect(html).toContain('Avaliações');
    expect(html).toContain('<strong>4,0</strong>');
    expect(html).toContain('1 avaliação');
    expect(html).toContain('Carla D.');
    expect(html).toContain('&lt;script&gt;x()&lt;/script&gt; ótimo');
    expect(html).not.toContain('<script>x()');
    expect(html).not.toContain(k.telefone);
  });

  it('slug histórico redireciona antes de ler avaliações', async () => {
    const t = await salaoNovo();
    await expect(pagina(t.slugHistorico)).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') });
  });
});

describe('CA-16: cabeçalhos da rota com token (next.config.ts)', () => {
  it('strict-origin (nunca no-referrer), no-store e noindex em /:slug/avaliar/:token', async () => {
    const regras = await nextConfig.headers!();
    const r = regras.find((x) => x.source === '/:slug/avaliar/:token');
    expect(r?.headers).toEqual([
      { key: 'Referrer-Policy', value: 'strict-origin' },
      { key: 'Cache-Control', value: 'no-store' },
      { key: 'X-Robots-Tag', value: 'noindex' },
    ]);
    expect(JSON.stringify(regras)).not.toContain('no-referrer');
  });
});

describe('CA-5: não existe rota que receba reserva + telefone', () => {
  function arquivos(dir: string): string[] {
    return readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? arquivos(p) : [p];
    });
  }

  it('a única rota de avaliação é /{slug}/avaliar/[token]; nenhuma pasta de rota avaliar usa reserva ou telefone', () => {
    const rotas = arquivos('src/app').filter((p) => /\/(page|route)\.tsx?$/.test(p) && /avalia/i.test(p));
    expect(rotas.sort()).toEqual(['src/app/(publico)/[slug]/avaliar/[token]/page.tsx', 'src/app/dev/avaliacao/page.tsx']);
    for (const p of arquivos('src/app/(publico)/[slug]/avaliar')) {
      expect(readFileSync(p, 'utf8'), p).not.toMatch(/telefone|reservaId|reserva_id/i);
    }
    expect(ROTAS.avaliar('salao', 'tok')).toBe('/salao/avaliar/tok');
  });

  it('o token nunca é registrado em log pelos módulos do envio', () => {
    for (const p of ['servico.ts', 'convite.ts']) {
      const texto = readFileSync(join('src/server/avaliacoes', p), 'utf8');
      expect(texto, p).not.toMatch(/console\.\w+\([^)]*token/i);
    }
  });
});
