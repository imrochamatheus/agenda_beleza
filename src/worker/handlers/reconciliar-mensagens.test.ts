import { describe, expect, it, vi } from 'vitest';

import { ErroFilaIndisponivel } from '@/server/queue/erros';
import type { RepoMensagemSistema } from '@/server/repos/mensagem-sistema';

import { criarReconciliarMensagens } from './reconciliar-mensagens';
import type { ContextoJob } from './tipos';

const AGORA = new Date('2026-11-21T12:00:00Z');
const ctx = (): ContextoJob => ({ id: 'j', fila: 'reconciliar-mensagens', tentativa: 1, tentativasMaximas: 5, agendadoPara: AGORA, sinal: new AbortController().signal, log: vi.fn() });
const pendente = (n: number) => ({
  id: `00000000-0000-4000-8000-00000000000${n}`, salaoId: 's', reservaId: `00000000-0000-4000-8000-0000000001${n}0`.slice(0, 36), tipo: 'confirmacao' as const, revisao: 0,
});

function montar(pendentes: ReturnType<typeof pendente>[], enviando = 0) {
  const chamadas: { antesDe: Date; limite: number }[] = [];
  const presas: { antesDe: Date; limite: number; agora: Date }[] = [];
  const sistema: RepoMensagemSistema = {
    localizar: async () => null,
    iniciarEnvio: async () => ({ resultado: 'nao_reivindicada' }),
    concluirEnvio: async () => false,
    listarPendentesAntigas: async (antesDe, limite) => {
      chamadas.push({ antesDe, limite });
      return pendentes;
    },
    expirarEnviandoPresas: async (antesDe, limite, agora) => {
      presas.push({ antesDe, limite, agora });
      return enviando;
    },
  };
  return { sistema, chamadas, presas };
}

describe('reconciliar-mensagens (RN-9; CA-8, CA-10)', () => {
  it('tem cron de 1 minuto e fila exclusive', () => {
    const h = criarReconciliarMensagens();
    expect(h.cron).toBe('* * * * *');
    expect(h.fila).toBe('reconciliar-mensagens');
  });

  it('usa os prazos e o lote, com o relógio injetado', async () => {
    const m = montar([]);
    await criarReconciliarMensagens({ sistema: m.sistema, agora: () => AGORA, enfileirar: vi.fn(), log: vi.fn() }).processar({}, ctx());
    expect(m.chamadas).toEqual([{ antesDe: new Date('2026-11-21T11:58:00Z'), limite: 100 }]);
    expect(m.presas).toEqual([{ antesDe: new Date('2026-11-21T11:55:00Z'), limite: 100, agora: AGORA }]);
  });

  it('enfileira cada pendente com a chave reserva:tipo:revisao e conta criadas e em uso', async () => {
    const m = montar([pendente(1), pendente(2), pendente(3)], 2);
    const enfileirar = vi
      .fn()
      .mockResolvedValueOnce({ criado: true, id: 'a' })
      .mockResolvedValueOnce({ criado: false, motivo: 'chave_em_uso' })
      .mockResolvedValueOnce({ criado: true, id: 'c' });
    const log = vi.fn();
    await criarReconciliarMensagens({ sistema: m.sistema, agora: () => AGORA, enfileirar, log }).processar({}, ctx());
    const p = pendente(1);
    expect(enfileirar).toHaveBeenNthCalledWith(1, 'whatsapp-reserva', { mensagemId: p.id }, { chave: `${p.reservaId}:confirmacao:0` });
    expect(log).toHaveBeenCalledExactlyOnceWith('mensagem.reconciliacao', { pendentesExaminadas: 3, reenfileiradas: 2, jaNaFila: 1, filaIndisponivel: 0, enviandoFechadas: 2 });
  });

  it('fila indisponível interrompe o lote sem lançar', async () => {
    const m = montar([pendente(1), pendente(2)]);
    const enfileirar = vi.fn().mockImplementation(() => Promise.reject(new ErroFilaIndisponivel('whatsapp-reserva', new Error('x'))));
    const log = vi.fn();
    await expect(criarReconciliarMensagens({ sistema: m.sistema, agora: () => AGORA, enfileirar, log }).processar({}, ctx())).resolves.toBeUndefined();
    expect(enfileirar).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('mensagem.reconciliacao', expect.objectContaining({ filaIndisponivel: 1, reenfileiradas: 0 }));
  });

  it('erro que não é da fila propaga (o job falha e o pg-boss repete)', async () => {
    const m = montar([pendente(1)]);
    const enfileirar = vi.fn().mockImplementation(() => Promise.reject(new TypeError('bug')));
    await expect(criarReconciliarMensagens({ sistema: m.sistema, agora: () => AGORA, enfileirar, log: vi.fn() }).processar({}, ctx())).rejects.toThrow('bug');
  });

  it('log padrão vai ao contexto do job, só com números', async () => {
    const m = montar([]);
    const c = ctx();
    await criarReconciliarMensagens({ sistema: m.sistema, agora: () => AGORA, enfileirar: vi.fn() }).processar({}, c);
    expect(c.log).toHaveBeenCalledWith('mensagem.reconciliacao', { pendentesExaminadas: 0, reenfileiradas: 0, jaNaFila: 0, filaIndisponivel: 0, enviandoFechadas: 0 });
  });
});
