// Fotos de demonstração PRÓPRIAS (D-036 RN-5): imagens geradas por código (gradientes nas cores do tema),
// nenhum arquivo de terceiros. Gera um PNG RGB (zlib do Node) e o `processarImagem` o converte em WebP.
import { crc32, deflateSync } from 'node:zlib';

const LARGURA = 1200;
const ALTURA = 800;

/** Pares de cores (earthy/nude, como em globals.css) para o gradiente diagonal de cada foto. */
const PALETAS: readonly (readonly [readonly number[], readonly number[]])[] = [
  [[0xe8, 0xd5, 0xc4], [0xa6, 0x7b, 0x5b]],
  [[0xf1, 0xe4, 0xd8], [0xc9, 0x9a, 0x7a]],
  [[0xd9, 0xc7, 0xb2], [0x7a, 0x5c, 0x45]],
  [[0xef, 0xe0, 0xd0], [0x9c, 0x7a, 0x60]],
];

function bloco(tipo: string, dados: Buffer): Buffer {
  const cabeca = Buffer.alloc(8);
  cabeca.writeUInt32BE(dados.length, 0);
  cabeca.write(tipo, 4, 'ascii');
  const corpo = Buffer.concat([Buffer.from(tipo, 'ascii'), dados]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(corpo) >>> 0, 0);
  return Buffer.concat([cabeca, dados, crc]);
}

/** PNG determinístico: a mesma `variante` produz sempre os mesmos bytes. */
export function gerarPngDeDemonstracao(variante: number): Uint8Array {
  const [de, para] = PALETAS[variante % PALETAS.length]!;
  const linhas = Buffer.alloc((LARGURA * 3 + 1) * ALTURA);
  for (let y = 0; y < ALTURA; y += 1) {
    const base = y * (LARGURA * 3 + 1);
    linhas[base] = 0; // filtro "nenhum"
    for (let x = 0; x < LARGURA; x += 1) {
      const t = (x / LARGURA + y / ALTURA) / 2;
      for (let c = 0; c < 3; c += 1) {
        linhas[base + 1 + x * 3 + c] = Math.round(de[c]! + (para[c]! - de[c]!) * t);
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(LARGURA, 0);
  ihdr.writeUInt32BE(ALTURA, 4);
  ihdr[8] = 8; // profundidade
  ihdr[9] = 2; // RGB
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      bloco('IHDR', ihdr),
      bloco('IDAT', deflateSync(linhas, { level: 9 })),
      bloco('IEND', Buffer.alloc(0)),
    ]),
  );
}

/** Chave de armazenamento determinística (formato de `CHAVE_REGEX`: fotos/<22+ [A-Za-z0-9_-]>.webp). */
export function chaveDaFotoDeDemonstracao(salaoId: string, n: number): string {
  return `fotos/demo-${salaoId.replaceAll('-', '')}-${n}.webp`;
}

export const ALT_DA_FOTO = (nomeSalao: string, n: number) => `Imagem de demonstração ${n} do ${nomeSalao}`;
