import { describe, expect, it } from 'vitest';

import { normalizarNome } from './texto';

const LIM = { min: 2, max: 100 };

describe('normalizarNome', () => {
  it('apara e colapsa espaços internos (inclusive não separáveis e ideográficos)', () => {
    expect(normalizarNome('  Ana   Paula  ', LIM)).toBe('Ana Paula');
    expect(normalizarNome('Ana  Paula', LIM)).toBe('Ana Paula');
    expect(normalizarNome('　Bia　', LIM)).toBe('Bia');
  });

  it('limites contados depois da normalização: 1 e 101 recusados, 2 e 100 aceitos', () => {
    expect(normalizarNome('A', LIM)).toBeNull();
    expect(normalizarNome('  A  ', LIM)).toBeNull();
    expect(normalizarNome('Al', LIM)).toBe('Al');
    expect(normalizarNome('a'.repeat(100), LIM)).toBe('a'.repeat(100));
    expect(normalizarNome('a'.repeat(101), LIM)).toBeNull();
    expect(normalizarNome(`  ${'a'.repeat(100)}  `, LIM)).toBe('a'.repeat(100));
  });

  it('vazio, só espaços, não texto e caracteres de controle → null', () => {
    for (const v of ['', '   ', undefined, null, 42, {}, ['Ana'], 'Ana\nPaula', 'Ana\tPaula', 'Ana\u0000']) {
      expect(normalizarNome(v, LIM), JSON.stringify(v) ?? String(v)).toBeNull();
    }
  });
});
