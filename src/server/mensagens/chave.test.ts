import { describe, expect, it } from 'vitest';

import { chaveDaMensagem } from './chave';

describe('chaveDaMensagem (RN-2)', () => {
  it('monta reserva:tipo:revisao', () => {
    expect(chaveDaMensagem('r-1', 'confirmacao', 0)).toBe('r-1:confirmacao:0');
    expect(chaveDaMensagem('r-1', 'convite_avaliacao', 0)).toBe('r-1:convite_avaliacao:0');
    expect(chaveDaMensagem('r-1', 'remarcacao', 12)).toBe('r-1:remarcacao:12');
  });

  it('chaves de revisões e tipos distintos são distintas', () => {
    const chaves = new Set([
      chaveDaMensagem('r', 'remarcacao', 1),
      chaveDaMensagem('r', 'remarcacao', 2),
      chaveDaMensagem('r', 'cancelamento', 2),
    ]);
    expect(chaves.size).toBe(3);
  });

  it.each([-1, 1.5, NaN])('revisão %s → RangeError', (revisao) => {
    expect(() => chaveDaMensagem('r', 'confirmacao', revisao)).toThrow(RangeError);
  });
});
