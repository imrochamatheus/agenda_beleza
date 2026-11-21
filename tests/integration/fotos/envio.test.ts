import type pg from 'pg';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { lerFotosPublicas } from '@/server/fotos/leitura';
import { CHAVE_REGEX } from '@/server/integrations/armazenamento/chave';
import { criarPublicoContext } from '@/server/tenant/context';

import { criarSalaoCompleto } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { jpegComExif, pngComAlfa, webp } from '../../support/imagens';
import { conectar } from '../../support/sql';

import { credGestor, fotosDe } from './apoio';
import { codigoDoRedirect, encerrarArmazenamento, enviarPorHttp, prepararArmazenamento } from './apoio-servico';
import type { Armazenamento } from './apoio-servico';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// D-021 T-7: CA-1 (envio, reprocessamento, chave, leitura pública na ordem de envio).

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
  arm.limpar();
});

describe('envio válido (CA-1)', () => {
  it('JPEG 4000×3000 com EXIF/GPS e orientação 6 sai 1200×1600, sem metadados, e a linha bate com o objeto', async () => {
    const cred = await credGestor(s);
    const r = await enviarPorHttp(cred, { arquivo: await jpegComExif(), alt: '  Fachada   do salão ', nome: '../../Segredo Ãçentos.JPG' });
    expect(r.status).toBe(303);
    expect(codigoDoRedirect(r)).toBe('ok');
    const [f] = await fotosDe(c, s.salaoId);
    expect(f).toMatchObject({ posicao: 1, alt: 'Fachada do salão', largura: 1200, altura: 1600 });
    expect(f.chave).toMatch(CHAVE_REGEX);
    expect(f.chave).not.toContain(s.salaoId);
    expect(f.chave.toLowerCase()).not.toContain('segredo');
    const bytes = readFileSync(join(arm.dir, f.chave));
    expect(f.bytes).toBe(bytes.length);
    expect(bytes.subarray(0, 4).toString()).toBe('RIFF');
    expect(bytes.subarray(8, 12).toString()).toBe('WEBP');
    const meta = await sharp(bytes).metadata();
    expect([meta.width, meta.height]).toEqual([1200, 1600]);
    expect(meta.exif).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(meta.icc).toBeUndefined();
    expect(bytes.includes(Buffer.from('Exif'))).toBe(false);
    expect(arm.objetos()).toHaveLength(1);
  });

  it('PNG com transparência e WebP 800×600: posições seguintes, alfa preservado, sem ampliar; leitura pública na ordem', async () => {
    const cred = await credGestor(s);
    await enviarPorHttp(cred, { arquivo: await jpegComExif(2000, 1000), alt: 'Primeira', envio: randomUUID() });
    expect(codigoDoRedirect(await enviarPorHttp(cred, { arquivo: await pngComAlfa(), alt: 'Segunda', envio: randomUUID(), tipo: 'image/png', nome: 'a.png' }))).toBe('ok');
    expect(codigoDoRedirect(await enviarPorHttp(cred, { arquivo: await webp(800, 600), alt: 'Terceira', envio: randomUUID(), tipo: 'image/webp' }))).toBe('ok');
    const fotos = await fotosDe(c, s.salaoId);
    expect(fotos.map((f) => [f.posicao, f.alt])).toEqual([[1, 'Primeira'], [2, 'Segunda'], [3, 'Terceira']]);
    expect([fotos[2].largura, fotos[2].altura]).toEqual([800, 600]);
    const png = await sharp(readFileSync(join(arm.dir, fotos[1].chave))).metadata();
    expect(png.hasAlpha).toBe(true);

    const publicas = await lerFotosPublicas(criarPublicoContext(s.salaoId, s.slugAtual));
    expect(publicas.map((p) => p.alt)).toEqual(['Primeira', 'Segunda', 'Terceira']);
  });

  it('um salaoId forjado no corpo é ignorado: a foto entra no salão da sessão', async () => {
    const outro = await criarSalaoCompleto();
    const cred = await credGestor(s);
    const r = await enviarPorHttp(cred, { arquivo: await webp(100, 100), alt: 'Forjada', extras: { salaoId: outro.salaoId, salao_id: outro.salaoId } });
    expect(codigoDoRedirect(r)).toBe('ok');
    expect((await fotosDe(c, s.salaoId)).map((x) => x.alt)).toEqual(['Forjada']);
    expect(await fotosDe(c, outro.salaoId)).toEqual([]);
  });
});
