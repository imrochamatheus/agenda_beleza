import { describe, expect, it } from 'vitest';

import { nomeDeExibicao } from './nome';

describe('nomeDeExibicao (RN-8)', () => {
  it.each([
    ['Maria Souza', 'Maria S.'],
    ['Maria da Silva Souza', 'Maria S.'],
    ['  ana   lima  ', 'ana L.'],
    ['Madonna', 'Madonna'],
    ['Érica Álvares', 'Érica Á.'],
    ['João 😀', 'João 😀.'],
    ['Ana ébano', 'Ana É.'],
  ])('%s → %s', (entrada, saida) => {
    expect(nomeDeExibicao(entrada)).toBe(saida);
  });

  it('normaliza para NFC (acento decomposto)', () => {
    expect(nomeDeExibicao('José Silva')).toBe('José S.');
    expect(nomeDeExibicao('Ana Élio')).toBe('Ana É.');
  });

  it.each([[null], [undefined], [''], ['   '], [42 as unknown as string]])('sem nome (%j) → null', (v) => {
    expect(nomeDeExibicao(v)).toBeNull();
  });

  it('nunca passa de 100 caracteres', () => {
    expect(Array.from(nomeDeExibicao(`${'a'.repeat(99)} ßeta`)!).length).toBeLessThanOrEqual(100);
    expect(Array.from(nomeDeExibicao('x'.repeat(300))!)).toHaveLength(100);
  });
});
