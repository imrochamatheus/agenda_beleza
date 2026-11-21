import { describe, expect, it } from 'vitest';

import { CHAVE_REGEX, ehChaveValida, gerarChave } from './chave';

describe('chave (RN-8)', () => {
  it('gera chaves únicas no formato, com 128 bits e sem dado do usuário', () => {
    const a = gerarChave();
    expect(a).toMatch(CHAVE_REGEX);
    expect(a).toMatch(/^fotos\/[A-Za-z0-9_-]{22}\.webp$/);
    expect(new Set(Array.from({ length: 200 }, gerarChave)).size).toBe(200);
  });
  it('valida o formato', () => {
    expect(ehChaveValida(gerarChave())).toBe(true);
    for (const v of ['', '../a.webp', 'fotos/a.webp', 'fotos/' + 'a'.repeat(22) + '.jpg', 'x/' + 'a'.repeat(22) + '.webp', 'fotos/' + 'a'.repeat(22) + '.webp\n', 5, null]) {
      expect(ehChaveValida(v)).toBe(false);
    }
  });
});
