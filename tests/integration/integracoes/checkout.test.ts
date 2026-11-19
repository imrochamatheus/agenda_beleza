import { randomUUID } from 'node:crypto';

import type pg from 'pg';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { POST, dynamic as dinamicaDecisao } from '@/app/dev/mp-checkout/decisao/route';
import CheckoutSimulado, { dynamic as dinamicaPagina, metadata } from '@/app/dev/mp-checkout/page';
import { DIAS_TESTE, PRECO_MENSAL_CENTAVOS } from '@/config/plano';
import {
  carregarCheckoutSimulado,
  decidirCheckoutSimulado,
} from '@/server/integrations/mercadopago/checkout-simulado';
import { criarMercadoPagoSimulado } from '@/server/integrations/mercadopago/simulado';

import { conectar, emailNovo } from '../../support/sql';

// CA-19 (RN-20): checkout do MP simulado contra o PostgreSQL real. A página é renderizada com
// react-dom/server e o route handler é chamado com um Request de formulário (como o navegador
// envia). Estado conferido por SQL direto (driver pg), independente do repositório.

const APP_URL = 'http://localhost:3000';
const RETORNO = `${APP_URL}/assinatura/retorno?origem=checkout`;
const FORJADA = 'https://atacante.exemplo/roubo';
const URL_DECISAO = `${APP_URL}/dev/mp-checkout/decisao`;
/** Porta 1 recusa a conexão na hora: qualquer consulta com esta URL falharia. */
const BANCO_INALCANCAVEL = 'postgresql://ninguem:nada@127.0.0.1:1/inexistente';

const SIMULADO = { MP_ADAPTER: 'simulado', APP_URL };
const REAL = { MP_ADAPTER: 'real', APP_URL };

const mp = criarMercadoPagoSimulado({ appUrl: APP_URL });

let c: pg.Client;

beforeAll(async () => {
  c = await conectar();
});
afterAll(async () => {
  await c.end();
});
beforeEach(() => {
  vi.stubEnv('MP_ADAPTER', 'simulado');
  vi.stubEnv('APP_URL', APP_URL);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

async function pendente(urlRetorno = RETORNO): Promise<string> {
  const { assinaturaId } = await mp.criarAssinatura({
    salaoId: randomUUID(),
    emailPagador: emailNovo(),
    urlRetorno,
  });
  return assinaturaId;
}

async function linha(id: string) {
  const r = await c.query<{ estado: string; autorizada_em: Date | null; proxima_cobranca_em: Date | null }>(
    'SELECT estado::text AS estado, autorizada_em, proxima_cobranca_em FROM sim_mp_assinatura WHERE id = $1',
    [id],
  );
  return r.rows[0];
}

/** POST como o formulário do navegador (application/x-www-form-urlencoded). */
function postar(campos: Record<string, string>): Promise<Response> {
  return POST(new Request(URL_DECISAO, { method: 'POST', body: new URLSearchParams(campos) }));
}

/** O `Location` esperado: a urlRetorno gravada + preapproval_id. */
function destino(id: string, urlRetorno = RETORNO): string {
  const u = new URL(urlRetorno);
  u.searchParams.set('preapproval_id', id);
  return u.toString();
}

async function renderizar(busca: Record<string, string | string[] | undefined>): Promise<string> {
  const elemento = await CheckoutSimulado({ searchParams: Promise.resolve(busca) });
  return renderToStaticMarkup(elemento);
}

type Tag = { atributos: Record<string, string>; texto: string };

/** Tags `<nome …>texto</nome>` (ou vazias) do HTML, com os atributos num mapa: a ordem não importa. */
function tags(html: string, nome: string): Tag[] {
  const re = new RegExp(`<${nome}\\b([^>]*?)/?>(?:([^<]*)</${nome}>)?`, 'g');
  return [...html.matchAll(re)].map((m) => ({
    atributos: Object.fromEntries([...m[1].matchAll(/([\w-]+)="([^"]*)"/g)].map((a) => [a[1], a[2]])),
    texto: m[2] ?? '',
  }));
}

async function digestDe(p: Promise<unknown>): Promise<string | undefined> {
  const erro = await p.then(
    () => {
      throw new Error('deveria ter lançado notFound()');
    },
    (e: unknown) => e,
  );
  return (erro as { digest?: string }).digest;
}

describe('CA-19: página /dev/mp-checkout', () => {
  it('CA-19: assinatura pendente → mostra "R$ 79,00", "30 dias grátis" e a ação de autorizar, sem pedir cartão', async () => {
    const id = await pendente();

    const html = await renderizar({ assinatura: id });

    // Intl pt-BR separa "R$" do valor com espaço não separável (U+00A0).
    expect(html).toContain('R$ 79,00');
    expect(html).toContain(`${DIAS_TESTE} dias grátis`);
    expect(html).toContain('Assinatura Agenda Beleza');
    expect(html).toContain('Ambiente simulado: nenhum dado de cartão é pedido.');
    expect(tags(html, 'form').map((f) => f.atributos)).toEqual([
      { method: 'post', action: '/dev/mp-checkout/decisao' },
    ]);
    // Único campo de entrada: o ID oculto (nenhum campo de cartão).
    expect(tags(html, 'input').map((i) => i.atributos)).toEqual([
      { type: 'hidden', name: 'assinatura', value: id },
    ]);
    const botoes = tags(html, 'button');
    expect(botoes.map((b) => [b.atributos.type, b.atributos.name, b.atributos.value, b.texto])).toEqual([
      ['submit', 'decisao', 'autorizar', 'Autorizar assinatura'],
      ['submit', 'decisao', 'desistir', 'Desistir'],
    ]);
    // Teclado: o foco inicial vai para "Autorizar"; nenhum estilo remove o contorno de foco.
    expect(botoes.map((b) => 'autofocus' in b.atributos)).toEqual([true, false]);
    expect(html).not.toMatch(/outline/);
  });

  it('CA-19: assinatura já autorizada → informa o estado e só oferece voltar', async () => {
    const id = await pendente();
    await mp.autorizar(id);

    const html = await renderizar({ assinatura: id });

    expect(html).toContain('Esta assinatura já foi autorizada.');
    expect(html).not.toContain('Autorizar assinatura');
    const botoes = tags(html, 'button');
    expect(botoes.map((b) => [b.atributos.value, b.texto, 'autofocus' in b.atributos])).toEqual([
      ['desistir', 'Voltar ao Agenda Beleza', true],
    ]);
  });

  it('CA-19: assinatura cancelada → informa o estado', async () => {
    const id = await pendente();
    await mp.cancelar(id);
    expect(await renderizar({ assinatura: id })).toContain('Esta assinatura foi cancelada.');
  });

  it('CA-19: identificador inexistente, inválido, ausente ou repetido → notFound() (404)', async () => {
    for (const busca of [
      { assinatura: randomUUID() },
      { assinatura: 'nao-e-uuid' },
      {},
      { assinatura: [randomUUID(), randomUUID()] },
    ]) {
      expect(await digestDe(renderizar(busca))).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
    }
  });

  it('CA-19: com MP_ADAPTER=real → notFound() mesmo para uma assinatura existente', async () => {
    const id = await pendente();
    vi.stubEnv('MP_ADAPTER', 'real');
    expect(await digestDe(renderizar({ assinatura: id }))).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
  });

  it('RN-20: rota dinâmica e fora dos buscadores', () => {
    expect(dinamicaPagina).toBe('force-dynamic');
    expect(dinamicaDecisao).toBe('force-dynamic');
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});

describe('CA-19: carregarCheckoutSimulado', () => {
  it('CA-19: devolve os dados da assinatura gravada', async () => {
    const id = await pendente();
    await expect(carregarCheckoutSimulado(id, SIMULADO)).resolves.toEqual({
      assinaturaId: id,
      valorCentavos: PRECO_MENSAL_CENTAVOS,
      diasTeste: DIAS_TESTE,
      estado: 'pendente',
    });
  });

  it('CA-19: fora do modo simulado (real ou seletor inválido) devolve null sem consultar o banco', async () => {
    const id = await pendente();
    // Com o banco inalcançável, qualquer consulta lançaria: o null prova que não houve consulta.
    vi.stubEnv('DATABASE_URL', BANCO_INALCANCAVEL);
    await expect(carregarCheckoutSimulado(id, REAL)).resolves.toBeNull();
    await expect(carregarCheckoutSimulado(id, { MP_ADAPTER: 'outro' })).resolves.toBeNull();
    // Controle: no modo simulado, a mesma chamada consulta o banco e falha.
    await expect(carregarCheckoutSimulado(id, SIMULADO)).rejects.toThrow();
  });

  it('modo simulado é o padrão (seletor ausente ou vazio)', async () => {
    const id = await pendente();
    await expect(carregarCheckoutSimulado(id, {})).resolves.toMatchObject({ assinaturaId: id });
    await expect(carregarCheckoutSimulado(id, { MP_ADAPTER: '' })).resolves.toMatchObject({ assinaturaId: id });
  });
});

describe('CA-19: POST /dev/mp-checkout/decisao', () => {
  it('CA-19: autorizar → assinatura autorizada e 303 para a urlRetorno GRAVADA, ignorando a URL forjada', async () => {
    const id = await pendente();

    const r = await postar({ assinatura: id, decisao: 'autorizar', urlRetorno: FORJADA, redirect: FORJADA });

    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toBe(destino(id));
    expect(r.headers.get('location')).not.toContain('atacante');
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(await r.text()).toBe('');
    const depois = await linha(id);
    expect(depois.estado).toBe('autorizada');
    expect(depois.proxima_cobranca_em!.getTime() - depois.autorizada_em!.getTime()).toBe(DIAS_TESTE * 86_400_000);
  });

  it('CA-19: desistir → 303 para a urlRetorno gravada e a assinatura continua pendente', async () => {
    const id = await pendente();

    const r = await postar({ assinatura: id, decisao: 'desistir', urlRetorno: FORJADA });

    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toBe(destino(id));
    expect(await linha(id)).toEqual({ estado: 'pendente', autorizada_em: null, proxima_cobranca_em: null });
  });

  it('CA-19: autorizar de novo (duplo clique) ou numa cancelada → sem efeito, só redireciona', async () => {
    const id = await pendente();
    expect((await postar({ assinatura: id, decisao: 'autorizar' })).status).toBe(303);
    const primeira = await linha(id);

    const r = await postar({ assinatura: id, decisao: 'autorizar' });
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toBe(destino(id));
    expect(await linha(id)).toEqual(primeira);

    const cancelada = await pendente();
    await mp.cancelar(cancelada);
    const rc = await postar({ assinatura: cancelada, decisao: 'autorizar' });
    expect(rc.status).toBe(303);
    expect((await linha(cancelada)).estado).toBe('cancelada');
  });

  it('CA-19: preserva a query da urlRetorno gravada e não duplica preapproval_id', async () => {
    const retorno = `${APP_URL}/assinatura/retorno?preapproval_id=antigo&x=1`;
    const id = await pendente(retorno);
    const r = await postar({ assinatura: id, decisao: 'desistir' });
    const location = new URL(r.headers.get('location')!);
    expect(location.origin + location.pathname).toBe(`${APP_URL}/assinatura/retorno`);
    expect(location.searchParams.getAll('preapproval_id')).toEqual([id]);
    expect(location.searchParams.get('x')).toBe('1');
  });

  it('CA-19: identificador inexistente ou inválido → 404', async () => {
    for (const assinatura of [randomUUID(), 'nao-e-uuid', '']) {
      const r = await postar({ assinatura, decisao: 'autorizar' });
      expect(r.status).toBe(404);
      expect(r.headers.get('location')).toBeNull();
      expect(await r.text()).toBe('');
    }
  });

  it('decisão ausente ou desconhecida, ou sem assinatura → 404 sem efeito', async () => {
    const id = await pendente();
    const casos: Record<string, string>[] = [
      { assinatura: id },
      { assinatura: id, decisao: 'aprovar' },
      { decisao: 'autorizar' },
    ];
    for (const campos of casos) {
      expect((await postar(campos)).status).toBe(404);
    }
    expect((await linha(id)).estado).toBe('pendente');
  });

  it('corpo que não é formulário → 404', async () => {
    const r = await POST(
      new Request(URL_DECISAO, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ assinatura: randomUUID(), decisao: 'autorizar' }),
      }),
    );
    expect(r.status).toBe(404);
  });

  it('CA-19: com MP_ADAPTER=real → 404, sem consultar o banco e sem autorizar', async () => {
    const id = await pendente();
    vi.stubEnv('MP_ADAPTER', 'real');

    const r = await postar({ assinatura: id, decisao: 'autorizar' });
    expect(r.status).toBe(404);
    expect(r.headers.get('location')).toBeNull();
    expect((await linha(id)).estado).toBe('pendente');

    // Sem consulta: com o banco inalcançável, a resposta continua 404 (nenhuma exceção).
    vi.stubEnv('DATABASE_URL', BANCO_INALCANCAVEL);
    expect((await postar({ assinatura: id, decisao: 'autorizar' })).status).toBe(404);
    const form = new FormData();
    form.set('assinatura', id);
    form.set('decisao', 'autorizar');
    await expect(decidirCheckoutSimulado(form, REAL)).resolves.toEqual({ status: 404 });
    // Controle: no modo simulado, a mesma decisão tenta o banco e falha.
    await expect(decidirCheckoutSimulado(form, SIMULADO)).rejects.toThrow();
    expect((await linha(id)).estado).toBe('pendente');
  });
});
