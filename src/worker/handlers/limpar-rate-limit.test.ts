import { describe, expect, it, vi } from 'vitest';

import { criarLimparRateLimit, limparRateLimit } from './limpar-rate-limit';
import type { ContextoJob } from './tipos';

describe('limpar-rate-limit', () => {
  it('cron horário em UTC, fila exclusive, payload estrito', () => {
    expect(limparRateLimit).toMatchObject({ fila: 'limpar-rate-limit', politica: 'exclusive', cron: '17 * * * *' });
    expect(limparRateLimit.validarPayload({})).toEqual({});
    expect(() => limparRateLimit.validarPayload({ a: 1 })).toThrow();
  });

  it('limpa com o relógio injetado e registra só a contagem', async () => {
    const agora = new Date('2026-11-21T12:00:00Z');
    const limpar = vi.fn(async () => 42);
    const log = vi.fn();
    await criarLimparRateLimit({ agora: () => agora, limpar }).processar({}, { log } as unknown as ContextoJob);
    expect(limpar).toHaveBeenCalledWith(agora);
    expect(log).toHaveBeenCalledWith('limpar-rate-limit.concluido', { apagadas: 42 });
  });

  it('sem injeção usa o relógio e a limpeza reais (assinatura)', () => {
    expect(typeof criarLimparRateLimit().processar).toBe('function');
  });
});
