import { describe, expect, it, vi } from 'vitest';

import { criarClienteHttp, TIMEOUT_PADRAO_MS, URL_BASE_PADRAO } from './http';
import { ErroEnvioTemporario } from './port';

const TOKEN = 'EAAG-token-ultra-secreto';

describe('criarClienteHttp (D-047)', () => {
  it('a constante padrão é menor que o encerramento do worker (25 s) (CA-6)', () => {
    expect(TIMEOUT_PADRAO_MS).toBeLessThan(25_000);
    expect(URL_BASE_PADRAO).toBe('https://graph.facebook.com');
  });

  it('um único POST com Bearer, JSON, redirect manual e sinal de timeout; devolve status e texto', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"a":1}', { status: 202 }));
    const http = criarClienteHttp({ token: TOKEN, urlBase: 'http://h.local///', fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(await http.postar('/v1/2/messages', { x: 1 })).toEqual({ status: 202, texto: '{"a":1}' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://h.local/v1/2/messages');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    });
    expect(init.body).toBe('{"x":1}');
    expect(init.redirect).toBe('manual');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('usa a URL padrão e o fetch global quando nada é injetado', async () => {
    const original = globalThis.fetch;
    const espiao = vi.fn(async () => new Response('', { status: 200 }));
    globalThis.fetch = espiao as unknown as typeof fetch;
    try {
      await criarClienteHttp({ token: TOKEN }).postar('/p', {});
      expect((espiao.mock.calls[0] as unknown as [string])[0]).toBe('https://graph.facebook.com/p');
    } finally {
      globalThis.fetch = original;
    }
  });

  it('limita o texto lido a 64 KiB', async () => {
    const fetchImpl = (async () => new Response('x'.repeat(100_000))) as unknown as typeof fetch;
    const r = await criarClienteHttp({ token: TOKEN, fetchImpl }).postar('/p', {});
    expect(r.texto).toHaveLength(64 * 1024);
  });

  it('falha de rede vira temporário `rede` e timeout vira `timeout`, sem cause nem token', async () => {
    const casos: [Error, string][] = [
      [Object.assign(new TypeError('fetch failed'), { cause: new Error(`ECONNREFUSED ${TOKEN}`) }), 'rede'],
      [new DOMException('x', 'TimeoutError'), 'timeout'],
      [new DOMException('x', 'AbortError'), 'timeout'],
    ];
    for (const [causa, codigo] of casos) {
      const fetchImpl = (async () => {
        throw causa;
      }) as unknown as typeof fetch;
      const e = (await criarClienteHttp({ token: TOKEN, fetchImpl }).postar('/p', {}).catch((x: unknown) => x)) as ErroEnvioTemporario;
      expect(e).toBeInstanceOf(ErroEnvioTemporario);
      expect(e.codigo).toBe(codigo);
      expect(e.cause).toBeUndefined();
      expect(JSON.stringify([e.message, e.stack])).not.toContain(TOKEN);
    }
  });
});
