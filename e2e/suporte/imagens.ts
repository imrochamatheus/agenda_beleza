import sharp from 'sharp';

// Imagens geradas para o E2E das fotos (D-021). Não é coletado (testMatch: **/*.spec.ts).

export async function jpegDeTeste(largura = 1200, altura = 800): Promise<Buffer> {
  return sharp({ create: { width: largura, height: altura, channels: 3, background: { r: 200, g: 170, b: 140 } } })
    .jpeg()
    .toBuffer();
}

export const arquivoDeFoto = async () => ({ name: 'minha foto.jpg', mimeType: 'image/jpeg', buffer: await jpegDeTeste() });
export const textoComoJpg = () => ({ name: 'foto.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('isto é só texto, não uma foto') });
