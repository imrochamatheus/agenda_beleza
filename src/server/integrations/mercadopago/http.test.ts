import { describe, expect, it, vi } from 'vitest';

import { criarClienteHttp, idParaCaminho } from './http';
import { ErroProvedor, OperacaoInvalidaNoProvedor, RecursoNaoEncontradoNoProvedor } from './port';

const TOKEN = 'APP_USR-token-ultra-secreto';
type Resp = Response | Error;

function cliente(respostas: Resp[], extra: { timeoutMs?: number } = {}) {
  const chamadas: { url: string; init: RequestInit }[] = [];
  const fila = [...respostas];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    chamadas.push({ url, init });
    const r = fila.shift();
    if (r === undefined) throw new Error('sem resposta programada');
    if (r instanceof Error) throw r;
    return r;
  }) as unknown as typeof fetch;
  const esperas: number[] = [];
  const esperar = vi.fn(async (ms: number) => {
    esperas.push(ms);
  });
  return { http: criarClienteHttp({ token: TOKEN, urlBase: 'https://api.teste/', fetchImpl, esperar, ...extra }), chamadas, esperas };
}

const json = (status: number, corpo: unknown = { ok: true }) => new Response(JSON.stringify(corpo), { status });
const falhaDeRede = () => Object.assign(new TypeError('fetch failed'), { cause: new Error(`ECONNREFUSED ${TOKEN}`) });
const tempoLimite = () => new DOMException('The operation was aborted due to timeout', 'TimeoutError');

describe('criarClienteHttp: requisição', () => {
  it('envia método, URL, Authorization, Content-Type só com corpo e a chave de idempotência', async () => {
    const { http, chamadas } = cliente([json(200, { a: 1 }), json(200)]);
    expect(await http.requisitar({ metodo: 'POST', caminho: '/preapproval', corpo: { x: 1 }, idempotencia: 'k1' })).toEqual({ a: 1 });
    await http.requisitar({ metodo: 'GET', caminho: '/preapproval/a' });
    const [post, get] = chamadas;
    expect(post.url).toBe('https://api.teste/preapproval');
    expect(post.init.method).toBe('POST');
    expect(post.init.body).toBe('{"x":1}');
    expect(post.init.headers).toMatchObject({ Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', 'X-Idempotency-Key': 'k1' });
    expect(post.init.signal).toBeInstanceOf(AbortSignal);
    expect(get.init.headers).not.toHaveProperty('Content-Type');
    expect(get.init.headers).not.toHaveProperty('X-Idempotency-Key');
    expect(get.init.body).toBeUndefined();
  });
});

describe('criarClienteHttp: tradução de erros (CA-7, RN-15)', () => {
  it.each([
    [404, RecursoNaoEncontradoNoProvedor],
    [400, OperacaoInvalidaNoProvedor],
    [409, OperacaoInvalidaNoProvedor],
    [422, OperacaoInvalidaNoProvedor],
    [401, ErroProvedor],
    [403, ErroProvedor],
  ])('PUT com %s', async (status, classe) => {
    const { http, chamadas } = cliente([json(status, { message: `detalhe ${TOKEN}` })]);
    const erro = await http.requisitar({ metodo: 'PUT', caminho: '/x', corpo: {} }).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(classe);
    expect(chamadas).toHaveLength(1);
    const e = erro as Error;
    expect(JSON.stringify([e.message, e.cause, e.stack?.split('\n')[0]])).not.toContain(TOKEN);
    expect(e.message).not.toContain('detalhe');
  });

  it('corpo 2xx que não é JSON: ErroProvedor; falha de rede e timeout: ErroProvedor sem vazar o token', async () => {
    for (const r of [new Response('<html>', { status: 200 }), falhaDeRede(), tempoLimite()]) {
      const { http } = cliente([r]);
      const e = (await http.requisitar({ metodo: 'PUT', caminho: '/x', corpo: {} }).catch((x: unknown) => x)) as Error;
      expect(e).toBeInstanceOf(ErroProvedor);
      expect(e.cause).toBeUndefined();
      expect(JSON.stringify([e.message, e.stack])).not.toContain(TOKEN);
    }
  });
});

describe('criarClienteHttp: repetição (CA-8)', () => {
  it('GET: 503, 503, 200 resolve em 3 requisições com esperas de 200 e 400 ms', async () => {
    const { http, chamadas, esperas } = cliente([json(503), json(503), json(200, { id: 1 })]);
    expect(await http.requisitar({ metodo: 'GET', caminho: '/a' })).toEqual({ id: 1 });
    expect(chamadas).toHaveLength(3);
    expect(esperas).toEqual([200, 400]);
  });

  it('GET: 503 x3 falha; 429, rede e timeout também repetem', async () => {
    const a = cliente([json(503), json(503), json(503)]);
    await expect(a.http.requisitar({ metodo: 'GET', caminho: '/a' })).rejects.toBeInstanceOf(ErroProvedor);
    expect(a.chamadas).toHaveLength(3);
    const b = cliente([json(429), falhaDeRede(), tempoLimite(), json(200)]);
    await expect(b.http.requisitar({ metodo: 'GET', caminho: '/a' })).rejects.toBeInstanceOf(ErroProvedor);
    expect(b.chamadas).toHaveLength(3);
  });

  it('GET: 404 e 400 não repetem', async () => {
    const { http, chamadas } = cliente([json(404)]);
    await expect(http.requisitar({ metodo: 'GET', caminho: '/a' })).rejects.toBeInstanceOf(RecursoNaoEncontradoNoProvedor);
    expect(chamadas).toHaveLength(1);
  });

  it('POST repete uma vez, com a MESMA chave, em 429 ou falha de conexão', async () => {
    for (const primeira of [json(429), falhaDeRede()]) {
      const { http, chamadas } = cliente([primeira, json(201, { id: 'z' })]);
      expect(await http.requisitar({ metodo: 'POST', caminho: '/p', corpo: {}, idempotencia: 'chave-1' })).toEqual({ id: 'z' });
      expect(chamadas.map((c) => (c.init.headers as Record<string, string>)['X-Idempotency-Key'])).toEqual(['chave-1', 'chave-1']);
    }
  });

  it('POST nunca repete em 5xx nem em timeout; e só uma repetição em 429', async () => {
    for (const r of [json(500), json(503), tempoLimite()]) {
      const { http, chamadas } = cliente([r, json(201)]);
      await expect(http.requisitar({ metodo: 'POST', caminho: '/p', corpo: {}, idempotencia: 'k' })).rejects.toBeInstanceOf(ErroProvedor);
      expect(chamadas).toHaveLength(1);
    }
    const { http, chamadas } = cliente([json(429), json(429), json(201)]);
    await expect(http.requisitar({ metodo: 'POST', caminho: '/p', corpo: {}, idempotencia: 'k' })).rejects.toBeInstanceOf(ErroProvedor);
    expect(chamadas).toHaveLength(2);
  });

  it('PUT não repete', async () => {
    for (const r of [json(503), json(429), falhaDeRede()]) {
      const { http, chamadas } = cliente([r, json(200)]);
      await expect(http.requisitar({ metodo: 'PUT', caminho: '/p', corpo: {} })).rejects.toBeInstanceOf(ErroProvedor);
      expect(chamadas).toHaveLength(1);
    }
  });

  it('usa a espera real quando não injetada', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json(503))
      .mockResolvedValueOnce(json(200, { ok: 1 })) as unknown as typeof fetch;
    const http = criarClienteHttp({ token: TOKEN, fetchImpl });
    expect(await http.requisitar({ metodo: 'GET', caminho: '/a' })).toEqual({ ok: 1 });
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe('https://api.mercadopago.com/a');
  });
});

describe('idParaCaminho (CA-11)', () => {
  it('aceita ids do MP e recusa traversal, espaço, vazio e > 64', () => {
    expect(idParaCaminho('2c938084726fca480172750000000000')).toBe('2c938084726fca480172750000000000');
    expect(idParaCaminho('a-b_c')).toBe('a-b_c');
    for (const ruim of ['a/b', '..', 'a b', '', 'a'.repeat(65), 'a?b', 'á', '../x']) {
      expect(() => idParaCaminho(ruim)).toThrow(RecursoNaoEncontradoNoProvedor);
    }
    expect(() => idParaCaminho(undefined as never)).toThrow(RecursoNaoEncontradoNoProvedor);
  });
});
