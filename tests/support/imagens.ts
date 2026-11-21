// Fixtures de imagem geradas com sharp (D-021 T-4). Sem binários versionados.
import sharp from 'sharp';

export const TOKEN_UUID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

/** Gradiente suave determinístico (comprime bem, cabe nos 5 MB). */
function ruido(largura: number, altura: number, canais: 3 | 4 = 3): Buffer {
  const b = Buffer.alloc(largura * altura * canais);
  for (let y = 0; y < altura; y++) {
    for (let x = 0; x < largura; x++) {
      const o = (y * largura + x) * canais;
      b[o] = (x * 255) / largura;
      b[o + 1] = (y * 255) / altura;
      b[o + 2] = ((x + y) * 255) / (largura + altura);
      if (canais === 4) b[o + 3] = 255;
    }
  }
  return b;
}

/** JPEG 4000×3000 com EXIF (GPS) e orientação 6. */
export async function jpegComExif(largura = 4000, altura = 3000): Promise<Buffer> {
  return sharp(ruido(largura, altura), { raw: { width: largura, height: altura, channels: 3 } })
    .withExif({ IFD0: { Copyright: 'segredo-exif' }, IFD3: { GPSLatitudeRef: 'S', GPSLatitude: '23/1 32/1 0/1' } })
    .withMetadata({ orientation: 6 })
    .jpeg({ quality: 80 })
    .toBuffer();
}

export async function pngComAlfa(largura = 400, altura = 300): Promise<Buffer> {
  return sharp({ create: { width: largura, height: altura, channels: 4, background: { r: 200, g: 20, b: 20, alpha: 0.5 } } })
    .png()
    .toBuffer();
}

export async function webp(largura = 800, altura = 600): Promise<Buffer> {
  return sharp(ruido(largura, altura), { raw: { width: largura, height: altura, channels: 3 } }).webp().toBuffer();
}

/** JPEG pequeno e válido (rápido para muitos envios). */
export async function jpegPequeno(cor = 128, largura = 64, altura = 48): Promise<Buffer> {
  return sharp({ create: { width: largura, height: altura, channels: 3, background: { r: cor, g: 90, b: 60 } } })
    .jpeg()
    .toBuffer();
}

/** JPEG com perfil ICC (Display-P3). */
export async function jpegDisplayP3(): Promise<Buffer> {
  return sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 255, g: 0, b: 0 } } })
    .toColourspace('p3' as never)
    .withIccProfile('p3')
    .jpeg()
    .toBuffer();
}

export async function jpegCmyk(): Promise<Buffer> {
  return sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 255, g: 0, b: 0 } } })
    .toColourspace('cmyk')
    .jpeg()
    .toBuffer();
}

/** PNG 10000×10000 monocromático (bomba de descompressão, 100 MP, poucos KB). */
export async function pngBomba(): Promise<Buffer> {
  return sharp({ create: { width: 10000, height: 10000, channels: 3, background: { r: 0, g: 0, b: 0 } } })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

export async function jpegTruncado(): Promise<Buffer> {
  const j = await jpegComExif(1200, 900);
  return j.subarray(0, Math.floor(j.length / 2));
}

export function pngComLixo(): Buffer {
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('isto nao e um png de verdade, so lixo')]);
}

/** WebP animado (3 quadros de cores diferentes); o primeiro é vermelho. */
export async function webpAnimado(): Promise<Buffer> {
  const quadro = (r: number, g: number, b: number) => Buffer.alloc(32 * 32 * 3, 0).map((_, i) => [r, g, b][i % 3]);
  const empilhado = Buffer.concat([quadro(255, 0, 0), quadro(0, 255, 0), quadro(0, 0, 255)]);
  return sharp(empilhado, { raw: { width: 32, height: 96, channels: 3 } })
    .webp({ loop: 0, delay: [100, 100, 100] } as never)
    .toBuffer()
    .then(async (b) => {
      // monta animação a partir de páginas: sharp aceita `pageHeight` no raw
      return sharp(empilhado, { raw: { width: 32, height: 96, channels: 3, pageHeight: 32 } as never })
        .webp({ loop: 0, delay: [100, 100, 100] } as never)
        .toBuffer()
        .catch(() => b);
    });
}

/** JPEG válido + preenchimento após o EOI até exatamente `bytes` (o sharp ignora o que vem depois). */
export async function jpegComTamanho(bytes: number): Promise<Buffer> {
  const base = await jpegPequeno();
  if (base.length > bytes) throw new Error('tamanho alvo menor que o JPEG base');
  return Buffer.concat([base, Buffer.alloc(bytes - base.length, 0)]);
}

export function textoComNomeDeFoto(): Buffer {
  return Buffer.from('isto é só texto, não uma foto');
}

export const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\n');
export const GIF = Buffer.from('GIF89a\x01\x00\x01\x00\x80\x00\x00\x00\x00\x00\xff\xff\xff!\xf9\x04\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;', 'binary');
export const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');
