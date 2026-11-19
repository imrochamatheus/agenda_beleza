import { describe, expect, it } from 'vitest';

import { ehUuid } from './ids';

describe('ehUuid', () => {
  it('aceita UUID 8-4-4-4-12 hexadecimal de qualquer versão, maiúsculo ou minúsculo', () => {
    expect(ehUuid('0b0c5f6e-4a7d-4f0a-9a43-1f7f3c1e2d10')).toBe(true);
    expect(ehUuid('00000000-0000-0000-0000-000000000000')).toBe(true);
    expect(ehUuid('0B0C5F6E-4A7D-1F0A-9A43-1F7F3C1E2D10')).toBe(true);
  });

  it('recusa o que o driver rejeitaria (22P02) ou não é string', () => {
    const invalidos: unknown[] = [
      '',
      'abc',
      '0b0c5f6e4a7d4f0a9a431f7f3c1e2d10',
      '{0b0c5f6e-4a7d-4f0a-9a43-1f7f3c1e2d10}',
      ' 0b0c5f6e-4a7d-4f0a-9a43-1f7f3c1e2d10',
      '0b0c5f6e-4a7d-4f0a-9a43-1f7f3c1e2d10\n',
      '0b0c5f6e-4a7d-4f0a-9a43-1f7f3c1e2d1g',
      "1' OR '1'='1",
      null,
      undefined,
      42,
      {},
    ];
    for (const v of invalidos) {
      expect(ehUuid(v)).toBe(false);
    }
  });
});
