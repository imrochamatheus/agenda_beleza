import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ErroPayloadInvalido } from '@/server/queue/erros';

import { assinaturaPrazos } from './assinatura-prazos';
import { exemplo } from './exemplo';
import { reconciliarMensagens } from './reconciliar-mensagens';
import { REGISTRO } from './registry';
import type { ContextoJob } from './tipos';
import { whatsappReserva } from './whatsapp-reserva';

function contexto(sinal: AbortSignal = new AbortController().signal) {
  const log = vi.fn<ContextoJob['log']>();
  const ctx: ContextoJob = { id: 'j1', fila: 'exemplo', tentativa: 1, agendadoPara: new Date(), sinal, log };
  return { ctx, log };
}

describe('REGISTRO (RN-8, CA-7)', () => {
  it('tem exatamente as 4 filas de produção, com as políticas dos contratos e os crons padrão (D-3)', () => {
    expect(REGISTRO.map((d) => [d.fila, d.politica, d.cron ?? null])).toEqual([
      ['exemplo', 'standard', null],
      ['assinatura-prazos', 'exclusive', '*/5 * * * *'],
      ['whatsapp-reserva', 'exclusive', null],
      ['reconciliar-mensagens', 'exclusive', '* * * * *'],
    ]);
  });

  it('cada definição valida pelo contrato da própria fila', () => {
    expect(whatsappReserva.validarPayload({ mensagemId: '6f1c2b8e-3d4a-4b5c-9d6e-7f8091a2b3c4' })).toEqual({
      mensagemId: '6f1c2b8e-3d4a-4b5c-9d6e-7f8091a2b3c4',
    });
    expect(() => whatsappReserva.validarPayload({ mensagemId: 'x' })).toThrow(ErroPayloadInvalido);
    expect(() => assinaturaPrazos.validarPayload({ a: 1 })).toThrow(ErroPayloadInvalido);
    expect(reconciliarMensagens.validarPayload({})).toEqual({});
    expect(exemplo.validarPayload({ esperaMs: 5 })).toEqual({ esperaMs: 5 });
  });
});

describe('stubs (D-5, RN-17)', () => {
  it.each([
    ['assinatura-prazos', assinaturaPrazos, {}],
    ['reconciliar-mensagens', reconciliarMensagens, {}],
    ['whatsapp-reserva', whatsappReserva, { mensagemId: '6f1c2b8e-3d4a-4b5c-9d6e-7f8091a2b3c4' }],
  ] as const)('%s resolve sem registrar nada', async (_nome, def, payload) => {
    const { ctx, log } = contexto();
    await expect(def.processar(payload as never, ctx)).resolves.toBeUndefined();
    expect(log).not.toHaveBeenCalled();
  });
});

describe('exemplo (D-4)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('registra worker.exemplo_iniciado e espera esperaMs antes de concluir', async () => {
    const { ctx, log } = contexto();
    let concluiu = false;
    const p = exemplo.processar({ esperaMs: 1000 }, ctx).then(() => (concluiu = true));
    expect(log).toHaveBeenCalledExactlyOnceWith('worker.exemplo_iniciado', { id: 'j1', esperaMs: 1000 });
    await vi.advanceTimersByTimeAsync(999);
    expect(concluiu).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(concluiu).toBe(true);
  });

  it('sem esperaMs usa 0', async () => {
    const { ctx, log } = contexto();
    const p = exemplo.processar({}, ctx);
    await vi.advanceTimersByTimeAsync(0);
    await expect(p).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith('worker.exemplo_iniciado', { id: 'j1', esperaMs: 0 });
  });

  it('rejeita quando o sinal aborta durante a espera, sem deixar temporizador', async () => {
    const ac = new AbortController();
    const { ctx } = contexto(ac.signal);
    const p = exemplo.processar({ esperaMs: 60_000 }, ctx);
    ac.abort();
    await expect(p).rejects.toThrow('exemplo interrompido');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejeita na hora com o sinal já abortado', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(exemplo.processar({ esperaMs: 10 }, contexto(ac.signal).ctx)).rejects.toThrow('exemplo interrompido');
    expect(vi.getTimerCount()).toBe(0);
  });
});
