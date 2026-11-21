import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import {
  jpegCmyk,
  jpegComExif,
  jpegDisplayP3,
  jpegPequeno,
  jpegTruncado,
  pngBomba,
  pngComAlfa,
  pngComLixo,
  webp,
  webpAnimado,
} from '../../../tests/support/imagens';
import { decodificacoesAtivas, MAIOR_LADO, MAX_SIMULTANEAS, processarImagem } from './processar';

// D-021 T-4: CA-1 (parte pura), CA-2 (100 MP, truncado, lixo) e A-6/A-7.

async function ok(bytes: Uint8Array, tipo: 'jpeg' | 'png' | 'webp') {
  const r = await processarImagem(bytes, tipo);
  if (!r.ok) throw new Error(`falhou: ${r.erro}`);
  return r.imagem;
}

describe('processarImagem', () => {
  it('JPEG 4000×3000 com EXIF e orientação 6 sai 1200×1600, WebP, sem EXIF/XMP/ICC', async () => {
    const entrada = await jpegComExif();
    expect((await sharp(entrada).metadata()).exif).toBeDefined();
    const im = await ok(entrada, 'jpeg');
    expect([im.largura, im.altura]).toEqual([1200, 1600]);
    const saida = Buffer.from(im.bytes);
    expect(saida.subarray(0, 4).toString()).toBe('RIFF');
    expect(saida.subarray(8, 12).toString()).toBe('WEBP');
    const meta = await sharp(saida).metadata();
    expect(meta.format).toBe('webp');
    expect([meta.width, meta.height]).toEqual([1200, 1600]);
    expect(meta.exif).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(meta.icc).toBeUndefined();
    expect(saida.includes(Buffer.from('Exif'))).toBe(false);
    expect(saida.includes(Buffer.from('segredo-exif'))).toBe(false);
    expect(Math.max(im.largura, im.altura)).toBeLessThanOrEqual(MAIOR_LADO);
  });

  it('PNG com alfa preserva a transparência', async () => {
    const im = await ok(await pngComAlfa(), 'png');
    const meta = await sharp(Buffer.from(im.bytes)).metadata();
    expect(meta.hasAlpha).toBe(true);
    const { data } = await sharp(Buffer.from(im.bytes)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(data[3]).toBeGreaterThan(100);
    expect(data[3]).toBeLessThan(160);
  });

  it('WebP 800×600 não é ampliado; 1×1 e 5000×10 respeitam o limite', async () => {
    const im = await ok(await webp(800, 600), 'webp');
    expect([im.largura, im.altura]).toEqual([800, 600]);
    const um = await ok(await jpegPequeno(10, 1, 1), 'jpeg');
    expect([um.largura, um.altura]).toEqual([1, 1]);
    const longa = await ok(await sharp({ create: { width: 5000, height: 10, channels: 3, background: '#888' } }).png().toBuffer(), 'png');
    expect([longa.largura, longa.altura]).toEqual([1600, 3]);
  });

  it('WebP animado usa só o primeiro quadro', async () => {
    const entrada = await webpAnimado();
    const im = await ok(entrada, 'webp');
    const meta = await sharp(Buffer.from(im.bytes)).metadata();
    expect(meta.pages ?? 1).toBe(1);
    const { data } = await sharp(Buffer.from(im.bytes)).raw().toBuffer({ resolveWithObject: true });
    expect(data[0]).toBeGreaterThan(200); // primeiro quadro vermelho
    expect(data[1]).toBeLessThan(60);
  });

  it('Display-P3 e CMYK saem em sRGB, sem ICC, com cor próxima à original', async () => {
    for (const entrada of [await jpegDisplayP3(), await jpegCmyk()]) {
      const im = await ok(entrada, 'jpeg');
      const meta = await sharp(Buffer.from(im.bytes)).metadata();
      expect(meta.icc).toBeUndefined();
      expect(meta.space).toBe('srgb');
      const { data } = await sharp(Buffer.from(im.bytes)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      expect(data[0]).toBeGreaterThan(data[1]); // continua avermelhado
    }
  });

  it('100 MP → resolucao; truncado e lixo → ilegivel; formato diferente do cabeçalho → ilegivel', async () => {
    expect(await processarImagem(await pngBomba(), 'png')).toEqual({ ok: false, erro: 'resolucao' });
    expect(await processarImagem(await jpegTruncado(), 'jpeg')).toEqual({ ok: false, erro: 'ilegivel' });
    expect(await processarImagem(pngComLixo(), 'png')).toEqual({ ok: false, erro: 'ilegivel' });
    expect(await processarImagem(await pngComAlfa(), 'jpeg')).toEqual({ ok: false, erro: 'ilegivel' });
  }, 60_000);

  it('A-7: no máximo 2 decodificações simultâneas, e todas terminam', async () => {
    const entrada = await jpegComExif(1500, 1000);
    let pico = 0;
    const sonda = setInterval(() => {
      pico = Math.max(pico, decodificacoesAtivas());
    }, 1);
    const rs = await Promise.all(Array.from({ length: 6 }, () => processarImagem(entrada, 'jpeg')));
    clearInterval(sonda);
    expect(rs.every((r) => r.ok)).toBe(true);
    expect(pico).toBeLessThanOrEqual(MAX_SIMULTANEAS);
    expect(pico).toBeGreaterThan(0);
    expect(decodificacoesAtivas()).toBe(0);
  }, 60_000);
});
