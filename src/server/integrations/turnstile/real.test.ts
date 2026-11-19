import { inspect } from 'node:util';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { iniciarStubHttp, portaFechada, type StubHttp } from '../../../../tests/support/stubs/http';
import { TAMANHO_MAXIMO_TOKEN } from './port';
import { criarTurnstileReal, TIMEOUT_TURNSTILE_MS, URL_SITEVERIFY } from './real';

const SEGREDO = '0x4AAAAAAA-segredo-turnstile-7c1e';
const TOKEN = 'token-do-widget.0123456789abcdef';
const TIMEOUT_CURTO = 200;

let stub: StubHttp;

beforeEach(async () => {
  stub = await iniciarStubHttp();
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await stub.fechar();
});

function criar(extra: Partial<Parameters<typeof criarTurnstileReal>[0]> = {}) {
  return criarTurnstileReal({
    segredo: SEGREDO,
    lerChaveDoSite: () => 'chave-do-site',
    urlSiteverify: `${stub.url}/turnstile/v0/siteverify`,
    timeoutMs: TIMEOUT_CURTO,
    ...extra,
  });
}

function capturarSaida() {
  const espioes = [
    vi.spyOn(console, 'log'),
    vi.spyOn(console, 'info'),
    vi.spyOn(console, 'warn'),
    vi.spyOn(console, 'error'),
    vi.spyOn(console, 'debug'),
    vi.spyOn(process.stdout, 'write'),
    vi.spyOn(process.stderr, 'write'),
  ];
  return () => espioes.flatMap((e) => e.mock.calls.map((c) => c.map(String).join(' '))).join('\n');
}

function semSegredos(texto: string) {
  expect(texto).not.toContain(SEGREDO);
  expect(texto).not.toContain(TOKEN);
}

describe('constantes do Turnstile real (§3.3, D-11)', () => {
  it('siteverify da Cloudflare e tempo-limite de 5 s', () => {
    expect(URL_SITEVERIFY).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    expect(TIMEOUT_TURNSTILE_MS).toBe(5000);
  });
});

describe('criarTurnstileReal contra o stub HTTP (CA-5, CA-13)', () => {
  it('CA-13: success:true → válido; envia POST form-urlencoded com secret, response e remoteip', async () => {
    const resultado = await criar().validar({ token: TOKEN, ip: '203.0.113.7' });

    expect(resultado).toEqual({ valido: true });
    expect(stub.requisicoes).toHaveLength(1);
    const [req] = stub.requisicoes;
    expect(req.metodo).toBe('POST');
    expect(req.caminho).toBe('/turnstile/v0/siteverify');
    expect(req.cabecalhos['content-type']).toBe('application/x-www-form-urlencoded');
    expect(Object.fromEntries(new URLSearchParams(req.corpo))).toEqual({
      secret: SEGREDO,
      response: TOKEN,
      remoteip: '203.0.113.7',
    });
  });

  it('sem ip, não envia remoteip', async () => {
    await criar().validar({ token: TOKEN });
    expect(Object.fromEntries(new URLSearchParams(stub.requisicoes[0].corpo))).toEqual({
      secret: SEGREDO,
      response: TOKEN,
    });
  });

  it('CA-5: success:false → token_invalido', async () => {
    stub.definirResposta({ success: false, 'error-codes': ['invalid-input-response'] });
    expect(await criar().validar({ token: TOKEN })).toEqual({
      valido: false,
      motivo: 'token_invalido',
    });
    expect(stub.requisicoes).toHaveLength(1);
  });

  it.each([
    ['success ausente', { 'error-codes': [] }],
    ['success não booleano', { success: 'true' }],
    ['JSON que não é objeto', 'ok'],
    ['JSON nulo', null],
  ])('%s → indisponivel', async (_caso, resposta) => {
    stub.definirResposta(resposta);
    expect(await criar().validar({ token: TOKEN })).toEqual({ valido: false, motivo: 'indisponivel' });
  });

  it('CA-13/CA-12: HTTP 500 → indisponivel, sem lançar e sem segredo na saída', async () => {
    stub.definirModo('status500');
    const saida = capturarSaida();
    const resultado = await criar().validar({ token: TOKEN });
    expect(resultado).toEqual({ valido: false, motivo: 'indisponivel' });
    semSegredos(inspect(resultado));
    semSegredos(saida());
  });

  it('CA-13/CA-12: corpo não JSON → indisponivel, sem segredo na saída', async () => {
    stub.definirModo('naoJson');
    const saida = capturarSaida();
    const resultado = await criar().validar({ token: TOKEN });
    expect(resultado).toEqual({ valido: false, motivo: 'indisponivel' });
    semSegredos(inspect(resultado));
    semSegredos(saida());
  });

  it('CA-13/CA-12: stub que não responde → indisponivel dentro do tempo-limite configurado', async () => {
    stub.definirModo('silencioso');
    const saida = capturarSaida();
    const inicio = performance.now();

    const resultado = await criar().validar({ token: TOKEN });

    const decorrido = performance.now() - inicio;
    expect(resultado).toEqual({ valido: false, motivo: 'indisponivel' });
    expect(stub.requisicoes).toHaveLength(1);
    expect(decorrido).toBeGreaterThanOrEqual(TIMEOUT_CURTO - 20);
    expect(decorrido).toBeLessThan(2000);
    semSegredos(saida());
  });

  it('CA-12: porta fechada (erro de rede) → indisponivel, sem segredo na saída', async () => {
    const saida = capturarSaida();
    const porta = criar({ urlSiteverify: `http://127.0.0.1:${await portaFechada()}/siteverify` });
    expect(await porta.validar({ token: TOKEN })).toEqual({ valido: false, motivo: 'indisponivel' });
    semSegredos(saida());
  });

  it('CA-12: fetch que rejeita com erro contendo o segredo e o token → indisponivel, nada vaza', async () => {
    const saida = capturarSaida();
    const fetchQueFalha: typeof fetch = async (_url, init) => {
      throw new Error(`falhou: ${String(init?.body)}`, { cause: { segredo: SEGREDO, token: TOKEN } });
    };
    const resultado = await criar({ fetch: fetchQueFalha }).validar({ token: TOKEN });
    expect(resultado).toEqual({ valido: false, motivo: 'indisponivel' });
    semSegredos(inspect(resultado, { showHidden: true }));
    semSegredos(saida());
  });

  it.each([
    ['ausente', undefined],
    ['nulo', null],
    ['vazio', ''],
    ['só espaços', '   '],
    ['maior que o limite', 'x'.repeat(TAMANHO_MAXIMO_TOKEN + 1)],
  ])('CA-13: token %s → token_invalido e o stub não recebe requisição', async (_caso, token) => {
    expect(await criar().validar({ token })).toEqual({ valido: false, motivo: 'token_invalido' });
    expect(stub.requisicoes).toHaveLength(0);
  });

  it('usa a URL do siteverify da Cloudflare quando nenhuma é injetada', async () => {
    const chamadas: string[] = [];
    const fetchEspiao: typeof fetch = async (url) => {
      chamadas.push(String(url));
      return Response.json({ success: true });
    };
    const porta = criarTurnstileReal({
      segredo: SEGREDO,
      lerChaveDoSite: () => '',
      fetch: fetchEspiao,
    });
    expect(await porta.validar({ token: TOKEN })).toEqual({ valido: true });
    expect(chamadas).toEqual([URL_SITEVERIFY]);
  });
});

describe('chaveDoSite no real (CA-14)', () => {
  it('CA-14: lê a chave a cada chamada (valor vigente no runtime)', () => {
    const porta = criar({ lerChaveDoSite: () => process.env.TURNSTILE_SITE_KEY ?? '' });
    vi.stubEnv('TURNSTILE_SITE_KEY', 'chave-1');
    expect(porta.chaveDoSite()).toBe('chave-1');
    vi.stubEnv('TURNSTILE_SITE_KEY', 'chave-2');
    expect(porta.chaveDoSite()).toBe('chave-2');
  });
});
