import { describe, expect, it } from 'vitest';

import { LOTE_LIMPEZA, corteDaLimpeza, limparJanelasExpiradas } from './limpeza';

const AGORA = new Date('2026-11-21T12:00:00Z');

describe('corteDaLimpeza', () => {
  it('agora - (maior janela + 1 h)', () => {
    expect(corteDaLimpeza(AGORA, 900).toISOString()).toBe('2026-11-21T10:45:00.000Z');
    expect(corteDaLimpeza(AGORA, 3600).toISOString()).toBe('2026-11-21T10:00:00.000Z');
    // janela menor que a das autenticações (15 min): vale a de 15 min
    expect(corteDaLimpeza(AGORA, 60).toISOString()).toBe('2026-11-21T10:45:00.000Z');
  });
});

describe('limparJanelasExpiradas', () => {
  it('repete em lotes até esgotar e soma', async () => {
    const respostas = [LOTE_LIMPEZA, LOTE_LIMPEZA, 17];
    const cortes: Date[] = [];
    const total = await limparJanelasExpiradas(AGORA, {
      janelaSegundos: 900,
      remover: async (corte, lote) => {
        cortes.push(corte);
        expect(lote).toBe(LOTE_LIMPEZA);
        return respostas.shift()!;
      },
    });
    expect(total).toBe(2 * LOTE_LIMPEZA + 17);
    expect(cortes).toHaveLength(3);
    expect(new Set(cortes.map((c) => c.getTime())).size).toBe(1);
  });

  it('nada a apagar: uma chamada, zero', async () => {
    expect(await limparJanelasExpiradas(AGORA, { janelaSegundos: 900, remover: async () => 0 })).toBe(0);
  });

  it('sem janela injetada usa a do ambiente', async () => {
    expect(await limparJanelasExpiradas(AGORA, { remover: async () => 0 })).toBe(0);
  });
});
