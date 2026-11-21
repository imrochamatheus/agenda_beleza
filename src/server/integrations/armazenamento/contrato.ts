// Testes de contrato da PortaArmazenamento (D-021 T-2; CA-11): o mesmo conjunto roda para o adaptador
// simulado e para o real (servidor S3 falso). Só é importado por testes.
import { expect, it } from 'vitest';

import { gerarChave } from './chave';
import type { PortaArmazenamento } from './port';

export function rodarContratoDaPorta(fabrica: () => Promise<PortaArmazenamento> | PortaArmazenamento): void {
  const bytes = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4, 87, 69, 66, 80]);

  it('grava e lê os mesmos bytes', async () => {
    const porta = await fabrica();
    const chave = gerarChave();
    await porta.gravar(chave, bytes, 'image/webp');
    expect([...(await porta.ler(chave))!]).toEqual([...bytes]);
  });

  it('ler chave inexistente devolve null', async () => {
    const porta = await fabrica();
    expect(await porta.ler(gerarChave())).toBeNull();
  });

  it('remover apaga e remover o que não existe não é erro', async () => {
    const porta = await fabrica();
    const chave = gerarChave();
    await porta.gravar(chave, bytes, 'image/webp');
    await porta.remover(chave);
    expect(await porta.ler(chave)).toBeNull();
    await expect(porta.remover(chave)).resolves.toBeUndefined();
    await expect(porta.remover(gerarChave())).resolves.toBeUndefined();
  });

  it('regravar a mesma chave substitui o conteúdo', async () => {
    const porta = await fabrica();
    const chave = gerarChave();
    await porta.gravar(chave, bytes, 'image/webp');
    await porta.gravar(chave, new Uint8Array([9, 9]), 'image/webp');
    expect([...(await porta.ler(chave))!]).toEqual([9, 9]);
  });

  it('recusa chaves fora do formato em todas as operações', async () => {
    const porta = await fabrica();
    for (const ruim of ['../x.webp', '/fotos/a.webp', 'fotos\\a.webp', 'fotos/a\0b.webp', 'fotos/curta.webp', 'fotos/../../etc/passwd', '']) {
      await expect(porta.gravar(ruim, bytes, 'image/webp')).rejects.toThrow();
      await expect(porta.ler(ruim)).rejects.toThrow();
      await expect(porta.remover(ruim)).rejects.toThrow();
    }
  });
}
