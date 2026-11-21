import { describe, expect, it } from 'vitest';

import { TOKEN_UUID, jpegComExif, jpegTruncado, pngBomba, textoComNomeDeFoto } from '../../../../tests/support/imagens';

import { demonstrarEnvio, fotosDeExemplo } from './demonstracao';

// D-021 T-11: o envio de demonstração valida e processa em memória, na mesma ordem do serviço real.

const entrada = (c: { arquivo?: Uint8Array; alt?: string; envio?: string }) => ({
  obterCorpo: async () => ({ ok: true as const, arquivo: c.arquivo ?? new Uint8Array([1]), alt: c.alt ?? 'Fachada', envio: c.envio ?? TOKEN_UUID }),
});
const codigo = async (e: Parameters<typeof demonstrarEnvio>[0]) => {
  const r = await demonstrarEnvio(e);
  if (!r.ok) throw new Error('ação negada');
  return r.dados.resultado === 'ok' ? 'ok' : r.dados.codigo;
};

describe('demonstrarEnvio', () => {
  it('fotos de exemplo: n itens nas posições 1..n', () => {
    expect(fotosDeExemplo(3).map((f) => f.posicao)).toEqual([1, 2, 3]);
    expect(fotosDeExemplo(0)).toEqual([]);
  });

  it('JPEG válido é processado e aceito (sem gravar)', async () => {
    expect(await codigo(entrada({ arquivo: new Uint8Array(await jpegComExif(1200, 900)) }))).toBe('ok');
  });

  it('recusas na ordem do serviço: corpo, texto, token, tipo, decodificação', async () => {
    expect(await demonstrarEnvio({ obterCorpo: async () => ({ ok: false, codigo: 'tamanho' }) })).toEqual({ ok: true, dados: { resultado: 'recusado', codigo: 'tamanho' } });
    expect(await codigo(entrada({ alt: '' }))).toBe('alt_vazio');
    expect(await codigo(entrada({ alt: 'a'.repeat(151) }))).toBe('alt_longo');
    expect(await codigo(entrada({ envio: 'x' }))).toBe('falha');
    expect(await codigo(entrada({ arquivo: new Uint8Array(textoComNomeDeFoto()) }))).toBe('tipo');
    expect(await codigo(entrada({ arquivo: new Uint8Array(await jpegTruncado()) }))).toBe('ilegivel');
    expect(await codigo(entrada({ arquivo: new Uint8Array(await pngBomba()) }))).toBe('resolucao');
  }, 60_000);
});
