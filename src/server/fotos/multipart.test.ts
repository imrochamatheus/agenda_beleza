import { describe, expect, it } from 'vitest';

import { lerCorpoEnvio } from './multipart';
import { LIMITE_CORPO_BYTES, LIMITES_FOTO } from './tipos';

// D-021 T-5: CA-2 (tamanho, Content-Length, ausente/0 bytes) e §6 (multipart malformado, campo repetido).

const TOKEN = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

function formulario(foto: Uint8Array | null, extras: Record<string, string> = { alt: 'Fachada', envio: TOKEN }, repetirFoto = false): FormData {
  const f = new FormData();
  if (foto) f.append('foto', new Blob([foto as BlobPart]), 'foto.jpg');
  if (repetirFoto && foto) f.append('foto', new Blob([foto as BlobPart]), 'outra.jpg');
  for (const [k, v] of Object.entries(extras)) f.append(k, v);
  return f;
}

async function requisicao(f: FormData, cabecalhos: Record<string, string> = {}): Promise<Request> {
  const base = new Request('http://x.test/', { method: 'POST', body: f });
  const corpo = new Uint8Array(await base.arrayBuffer());
  return new Request('http://x.test/', {
    method: 'POST',
    body: corpo as BodyInit,
    headers: { 'content-type': base.headers.get('content-type') ?? '', ...cabecalhos },
  });
}

describe('lerCorpoEnvio', () => {
  it('lê foto, texto e token', async () => {
    const r = await lerCorpoEnvio(await requisicao(formulario(new Uint8Array([1, 2, 3]))));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect([...r.arquivo]).toEqual([1, 2, 3]);
      expect(r.alt).toBe('Fachada');
      expect(r.envio).toBe(TOKEN);
    }
  });

  it('campos ausentes viram texto vazio (a validação decide)', async () => {
    const r = await lerCorpoEnvio(await requisicao(formulario(new Uint8Array([1]), {})));
    expect(r).toMatchObject({ ok: true, alt: '', envio: '' });
  });

  it('foto ausente, vazia ou como texto → sem_arquivo', async () => {
    expect(await lerCorpoEnvio(await requisicao(formulario(null)))).toEqual({ ok: false, codigo: 'sem_arquivo' });
    expect(await lerCorpoEnvio(await requisicao(formulario(new Uint8Array(0))))).toEqual({ ok: false, codigo: 'sem_arquivo' });
    const f = formulario(null, { alt: 'a', foto: 'texto' });
    expect(await lerCorpoEnvio(await requisicao(f))).toEqual({ ok: false, codigo: 'sem_arquivo' });
  });

  it('5.242.880 bytes é aceito e 5.242.881 é recusado (tamanho)', async () => {
    const ok = await lerCorpoEnvio(await requisicao(formulario(new Uint8Array(LIMITES_FOTO.maxBytes))));
    expect(ok.ok).toBe(true);
    const grande = await lerCorpoEnvio(await requisicao(formulario(new Uint8Array(LIMITES_FOTO.maxBytes + 1))));
    expect(grande).toEqual({ ok: false, codigo: 'tamanho' });
  });

  it('Content-Length declarado acima do limite recusa sem ler o corpo', async () => {
    let lido = false;
    const stream = new ReadableStream<Uint8Array>({
      pull() {
        lido = true;
      },
    });
    const req = new Request('http://x.test/', {
      method: 'POST',
      body: stream,
      headers: { 'content-type': 'multipart/form-data; boundary=b', 'content-length': String(50 * 1024 * 1024) },
      // @ts-expect-error duplex é exigido pelo undici para corpo em fluxo
      duplex: 'half',
    });
    expect(await lerCorpoEnvio(req)).toEqual({ ok: false, codigo: 'tamanho' });
    expect(lido).toBe(false);
  });

  it('sem Content-Length, conta enquanto lê e aborta ao passar do limite', async () => {
    let enviados = 0;
    const bloco = new Uint8Array(1024 * 1024);
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        enviados += 1;
        c.enqueue(bloco);
        if (enviados > 20) c.close();
      },
    });
    const req = new Request('http://x.test/', {
      method: 'POST',
      body: stream,
      headers: { 'content-type': 'multipart/form-data; boundary=b' },
      // @ts-expect-error duplex é exigido pelo undici para corpo em fluxo
      duplex: 'half',
    });
    expect(await lerCorpoEnvio(req)).toEqual({ ok: false, codigo: 'tamanho' });
    expect(enviados * bloco.byteLength).toBeLessThanOrEqual(LIMITE_CORPO_BYTES + 2 * bloco.byteLength);
  });

  it('Content-Type não multipart, corpo malformado e campo repetido → falha', async () => {
    const json = new Request('http://x.test/', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
    expect(await lerCorpoEnvio(json)).toEqual({ ok: false, codigo: 'falha' });
    const mal = new Request('http://x.test/', { method: 'POST', body: 'lixo', headers: { 'content-type': 'multipart/form-data; boundary=zzz' } });
    expect(await lerCorpoEnvio(mal)).toEqual({ ok: false, codigo: 'falha' });
    expect(await lerCorpoEnvio(await requisicao(formulario(new Uint8Array([1]), undefined, true)))).toEqual({ ok: false, codigo: 'falha' });
    const dupAlt = formulario(new Uint8Array([1]));
    dupAlt.append('alt', 'outro');
    expect(await lerCorpoEnvio(await requisicao(dupAlt))).toEqual({ ok: false, codigo: 'falha' });
  });

  it('sem corpo → falha de multipart', async () => {
    const r = new Request('http://x.test/', { method: 'POST', headers: { 'content-type': 'multipart/form-data; boundary=b' } });
    expect(await lerCorpoEnvio(r)).toEqual({ ok: false, codigo: 'falha' });
  });
});
