import type pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { servirFoto } from '@/server/fotos/entrega';
import { lerFotosPublicas } from '@/server/fotos/leitura';
import { ErroDeArmazenamento } from '@/server/integrations/armazenamento/port';
import { integracoes } from '@/server/integrations/registry';
import { criarPublicoContext } from '@/server/tenant/context';

import { criarSalaoCompleto } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { jpegPequeno } from '../../support/imagens';
import { conectar } from '../../support/sql';

import { credGestor, fotosDe } from './apoio';
import { APP_URL, capturarLogs, encerrarArmazenamento, enviarPorHttp, prepararArmazenamento } from './apoio-servico';
import type { Armazenamento } from './apoio-servico';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

// D-021 T-7: CA-9 (entrega pública por id, sem sessão, sem listagem, com salão suspenso).

let c: pg.Client;
let s: SalaoCompleto;
let arm: Armazenamento;

beforeAll(async () => {
  c = await conectar();
  s = await criarSalaoCompleto();
  arm = prepararArmazenamento();
});
afterAll(async () => {
  encerrarArmazenamento(arm);
  await c.end();
});
afterEach(async () => {
  await c.query('DELETE FROM salao_foto WHERE salao_id = $1', [s.salaoId]);
  await c.query('UPDATE salao SET suspenso_manual_em = NULL WHERE id = $1', [s.salaoId]);
  arm.limpar();
  vi.restoreAllMocks();
});

const pedir = (id: string, cab: Record<string, string> = {}) => servirFoto(id, new Request(`${APP_URL}/api/fotos/${id}`, { headers: cab }));

async function umaFoto() {
  await enviarPorHttp(await credGestor(s), { arquivo: await jpegPequeno() });
  return (await fotosDe(c, s.salaoId))[0];
}

describe('entrega pública (CA-9)', () => {
  it('200 com os bytes do objeto e os cabeçalhos da RN-14; a URL da leitura pública é a rota da app', async () => {
    const f = await umaFoto();
    const [publica] = await lerFotosPublicas(criarPublicoContext(s.salaoId, s.slugAtual));
    expect(publica.url).toBe(`/api/fotos/${f.id}`);
    const r = await pedir(f.id);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('image/webp');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('cache-control')).toBe('public, max-age=3600');
    expect(r.headers.get('content-disposition')).toBe('inline');
    expect(r.headers.get('etag')).toBe(`"${f.id}"`);
    expect(Buffer.from(await r.arrayBuffer()).equals(readFileSync(join(arm.dir, f.chave)))).toBe(true);
  });

  it('If-None-Match igual (também lista, * e W/) → 304 sem corpo', async () => {
    const f = await umaFoto();
    for (const v of [`"${f.id}"`, `W/"${f.id}"`, `"outro", "${f.id}"`, '*']) {
      const r = await pedir(f.id, { 'if-none-match': v });
      expect(r.status).toBe(304);
      expect(await r.text()).toBe('');
    }
    expect((await pedir(f.id, { 'if-none-match': '"outro"' })).status).toBe(200);
  });

  it('id inexistente, malformado, de foto removida ou uma chave no lugar do id → 404', async () => {
    const f = await umaFoto();
    for (const ruim of ['00000000-0000-4000-8000-000000000000', 'abc', '..%2F..%2Fetc%2Fpasswd', '../../etc/passwd', f.chave, '']) {
      const r = await pedir(ruim);
      expect(r.status, ruim).toBe(404);
      expect(await r.text()).toBe('');
    }
    await c.query('DELETE FROM salao_foto WHERE id = $1', [f.id]);
    expect((await pedir(f.id)).status).toBe(404);
  });

  it('com o salão suspenso a foto continua sendo servida', async () => {
    const f = await umaFoto();
    await c.query('UPDATE salao SET suspenso_manual_em = now() WHERE id = $1', [s.salaoId]);
    expect((await pedir(f.id)).status).toBe(200);
  });

  it('objeto ausente com a linha existente → 404 e log objeto_ausente; falha do armazenamento → 502 sem detalhes', async () => {
    const f = await umaFoto();
    rmSync(join(arm.dir, f.chave));
    const logs = capturarLogs();
    expect((await pedir(f.id)).status).toBe(404);
    expect(logs()).toContain('armazenamento.objeto_ausente');
    vi.spyOn(integracoes().armazenamento, 'ler').mockRejectedValue(new ErroDeArmazenamento('disco quebrado em /var/segredo'));
    const r = await pedir(f.id);
    expect(r.status).toBe(502);
    expect(await r.text()).toBe('');
  });
});
