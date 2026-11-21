import { describe, expect, it } from 'vitest';

import { janelaDe, limitarPorIp, limitarPorNumero } from './limite';
import type { ConfigProtecao } from './config';

const CONFIG: ConfigProtecao = {
  proxyHops: 0,
  janelaSegundos: 900,
  limiteIp: { reserva: 3, disponibilidade: 2, avaliacao: 1, denuncia: 1 },
  limiteNumero: 2,
};
const SEGREDO = 's'.repeat(32);

function memoria() {
  const mapa = new Map<string, number>();
  const chamadas: { chave: string; janela: Date }[] = [];
  return {
    chamadas,
    incrementar: async (chave: string, janela: Date) => {
      chamadas.push({ chave, janela });
      const k = `${chave}|${janela.toISOString()}`;
      mapa.set(k, (mapa.get(k) ?? 0) + 1);
      return mapa.get(k)!;
    },
  };
}

describe('janelaDe', () => {
  it('janela fixa em UTC', () => {
    const { inicio, fim } = janelaDe(new Date('2026-11-21T12:07:30Z'), 900);
    expect(inicio.toISOString()).toBe('2026-11-21T12:00:00.000Z');
    expect(fim.toISOString()).toBe('2026-11-21T12:15:00.000Z');
  });
});

describe('limitarPorIp', () => {
  const agora = new Date('2026-11-21T12:07:30Z');

  it('permite K e nega a K+1, informando quando reinicia', async () => {
    const m = memoria();
    const d = { incrementar: m.incrementar, config: CONFIG };
    for (let i = 0; i < 3; i++) expect(await limitarPorIp('1.1.1.1', 'reserva', agora, d)).toEqual({ permitido: true });
    expect(await limitarPorIp('1.1.1.1', 'reserva', agora, d)).toEqual({
      permitido: false,
      reiniciaEm: new Date('2026-11-21T12:15:00Z'),
    });
  });

  it('escopos e IPs não compartilham contador; a janela seguinte reinicia', async () => {
    const m = memoria();
    const d = { incrementar: m.incrementar, config: CONFIG };
    expect((await limitarPorIp('1.1.1.1', 'avaliacao', agora, d)).permitido).toBe(true);
    expect((await limitarPorIp('1.1.1.1', 'avaliacao', agora, d)).permitido).toBe(false);
    expect((await limitarPorIp('1.1.1.1', 'denuncia', agora, d)).permitido).toBe(true);
    expect((await limitarPorIp('2.2.2.2', 'avaliacao', agora, d)).permitido).toBe(true);
    expect((await limitarPorIp('1.1.1.1', 'avaliacao', new Date('2026-11-21T12:15:00Z'), d)).permitido).toBe(true);
  });

  it('usa a configuração do ambiente quando não injetada', async () => {
    const m = memoria();
    expect((await limitarPorIp('1.1.1.1', 'reserva', agora, { incrementar: m.incrementar })).permitido).toBe(true);
    expect(m.chamadas[0].janela.toISOString()).toBe('2026-11-21T12:00:00.000Z');
  });
});

describe('limitarPorNumero', () => {
  it('limite por número e salão; HMAC na chave', async () => {
    const m = memoria();
    const d = { incrementar: m.incrementar, config: CONFIG, segredo: SEGREDO };
    const agora = new Date('2026-11-21T12:00:00Z');
    expect((await limitarPorNumero('a', '+5511987654321', agora, d)).permitido).toBe(true);
    expect((await limitarPorNumero('a', '+5511987654321', agora, d)).permitido).toBe(true);
    expect((await limitarPorNumero('a', '+5511987654321', agora, d)).permitido).toBe(false);
    expect((await limitarPorNumero('b', '+5511987654321', agora, d)).permitido).toBe(true);
    expect(m.chamadas.every((c) => !c.chave.includes('5511987654321'))).toBe(true);
  });

  it('sem config injetada usa o ambiente', async () => {
    const m = memoria();
    expect((await limitarPorNumero('a', '+5511987654321', new Date(), { incrementar: m.incrementar })).permitido).toBe(true);
  });
});
