import { describe, expect, it } from 'vitest';

import { GIF, PDF, SVG } from '../../../tests/support/imagens';
import { detectarTipo } from './detectar';

describe('detectarTipo (RN-5)', () => {
  it('reconhece JPEG, PNG e WebP pelos bytes iniciais', () => {
    expect(detectarTipo(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg');
    expect(detectarTipo(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe('png');
    expect(detectarTipo(new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]))).toBe('webp');
  });
  it('recusa GIF, PDF, SVG, texto, vazio, RIFF que não é WebP e prefixos curtos', () => {
    for (const b of [GIF, PDF, SVG, Buffer.from('texto'), Buffer.alloc(0)]) expect(detectarTipo(b)).toBeNull();
    expect(detectarTipo(new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x41, 0x56, 0x49, 0x20]))).toBeNull();
    expect(detectarTipo(new Uint8Array([0xff, 0xd8]))).toBeNull();
    expect(detectarTipo(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    expect(detectarTipo(new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45]))).toBeNull();
  });
});
