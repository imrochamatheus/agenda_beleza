import { describe, expect, it, vi } from 'vitest';

import { ErroPayloadInvalido } from '@/server/queue/erros';

import { assinaturaPrazos, criarAssinaturaPrazos } from './assinatura-prazos';
import type { ContextoJob } from './tipos';

const AGORA = new Date('2027-03-10T00:00:00Z');
const ctx = () => {
  const log = vi.fn<ContextoJob['log']>();
  const c: ContextoJob = { id: 'j', fila: 'assinatura-prazos', tentativa: 1, tentativasMaximas: 5, agendadoPara: AGORA, sinal: new AbortController().signal, log };
  return { c, log };
};

describe('assinatura-prazos (D-037 CA-17)', () => {
  it('mantém fila exclusive, cron de 5 min e payload vazio', () => {
    expect(assinaturaPrazos.fila).toBe('assinatura-prazos');
    expect(assinaturaPrazos.politica).toBe('exclusive');
    expect(assinaturaPrazos.cron).toBe('*/5 * * * *');
    expect(assinaturaPrazos.validarPayload({})).toEqual({});
    expect(() => assinaturaPrazos.validarPayload({ a: 1 })).toThrow(ErroPayloadInvalido);
  });

  it('injeta o relógio só na borda e repassa o log do job', async () => {
    const { c, log } = ctx();
    const processar = vi.fn(async (_a: Date, l: (e: string, c: Record<string, unknown>) => void) => {
      l('assinatura.prazos', { examinadas: 1 });
      return { examinadas: 1, transitadas: 1, ignoradas: 0, falhas: 0, ocupadas: 0 };
    });
    await criarAssinaturaPrazos({ agora: () => AGORA, processar }).processar({}, c);
    expect(processar.mock.calls[0][0]).toBe(AGORA);
    expect(log).toHaveBeenCalledWith('assinatura.prazos', { examinadas: 1 });
  });

  it('erro do processamento propaga (o pg-boss reexecuta no próximo ciclo)', async () => {
    const { c } = ctx();
    await expect(criarAssinaturaPrazos({ processar: async () => { throw new Error('x'); } }).processar({}, c)).rejects.toThrow('x');
  });
});
