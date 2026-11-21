import { afterEach, describe, expect, it, vi } from 'vitest';

import { TOKEN_UUID, jpegPequeno } from '../../../../../tests/support/imagens';

import { POST } from './route';

// D-021 T-11: handler de demonstração: 404 sem vitrine, Origin da própria requisição, 303 com código.

afterEach(() => {
  vi.unstubAllEnvs();
});

async function requisicao(origem: string | null, alt = 'Fachada') {
  const f = new FormData();
  f.append('foto', new Blob([new Uint8Array(await jpegPequeno())], { type: 'image/jpeg' }), 'a.jpg');
  f.append('alt', alt);
  f.append('envio', TOKEN_UUID);
  const base = new Request('http://127.0.0.1:3000/dev/fotos/enviar', { method: 'POST', body: f });
  const corpo = new Uint8Array(await base.arrayBuffer());
  const headers: Record<string, string> = { 'content-type': base.headers.get('content-type')!, host: '127.0.0.1:3000' };
  if (origem) headers.origin = origem;
  return new Request('http://127.0.0.1:3000/dev/fotos/enviar', { method: 'POST', body: corpo, headers });
}

describe('POST /dev/fotos/enviar', () => {
  it('vitrine desligada → 404', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITRINE_COMPONENTES', 'false');
    expect((await POST(await requisicao('http://127.0.0.1:3000'))).status).toBe(404);
  });

  it('ligada: Origin da própria requisição → 303 com o código; outro Origin ou nenhum → 403', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    const ok = await POST(await requisicao('http://127.0.0.1:3000'));
    expect(ok.status).toBe(303);
    expect(ok.headers.get('location')).toBe('/dev/fotos?envio=ok');
    const erro = await POST(await requisicao('http://127.0.0.1:3000', ''));
    expect(erro.headers.get('location')).toBe('/dev/fotos?envio=alt_vazio');
    expect((await POST(await requisicao('https://atacante.test'))).status).toBe(403);
    expect((await POST(await requisicao(null))).status).toBe(403);
    expect((await POST(await requisicao('nao-e-url'))).status).toBe(403);
    expect((await POST(await requisicao('http://127.0.0.1:3001'))).status).toBe(403);
  });
});
