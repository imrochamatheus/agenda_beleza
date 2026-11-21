import { beforeEach, describe, expect, it, vi } from 'vitest';

import { contextoDeSistema } from '@/server/tenant/context';
import { NaoEncontrado } from '@/server/tenant/erros';

const ID = '6f1c2b8e-3d4a-4b5c-9d6e-7f8091a2b3c4';
const RESERVA = '5d2a9b1c-3e4f-4a5b-8c6d-7e8f9a0b1c2d';
const ctx = contextoDeSistema('0b0c5f6e-4a7d-4f0a-9a43-1f7f3c1e2d10', 'teste');
const AGORA = new Date('2026-11-21T12:00:00Z');

// Sem vi.fn(): o espião do Vitest anexa um .then à promessa devolvida, e uma rejeição vira "não tratada".
let respostaDoRepo: () => Promise<unknown> = async () => undefined;
const chamadasDoRepo: unknown[][] = [];
const reenviarRepo = (...args: unknown[]) => {
  chamadasDoRepo.push(args);
  return respostaDoRepo();
};
vi.mock('@/server/repos/transacao', () => ({
  emTransacao: (fn: (r: unknown) => unknown) => fn({ mensagens: { reenviar: reenviarRepo } }),
}));

import { reenviarMensagem } from './reenviar';

const responder = (v: unknown) => {
  respostaDoRepo = async () => v;
};

beforeEach(() => {
  chamadasDoRepo.length = 0;
});

describe('reenviarMensagem (RN-18; CA-6)', () => {
  it('recusa sem enfileirar', async () => {
    responder({ resultado: 'recusada', motivo: 'nao_falhou' });
    const enfileirar = vi.fn();
    expect(await reenviarMensagem(ctx, ID, AGORA, { enfileirar })).toEqual({ resultado: 'recusada', motivo: 'nao_falhou' });
    expect(enfileirar).not.toHaveBeenCalled();
  });

  it('reenfileira depois da transação, com a mesma chave e payload mínimo', async () => {
    responder({ resultado: 'reenfileirada', mensagemId: ID, reservaId: RESERVA, tipo: 'remarcacao', revisao: 2 });
    const enfileirar = vi.fn(async () => ({ criado: true as const, id: 'j' }));
    const r = await reenviarMensagem(ctx, ID, AGORA, { enfileirar });
    expect(r).toEqual({ resultado: 'reenfileirada', mensagemId: ID, chave: `${RESERVA}:remarcacao:2` });
    expect(enfileirar).toHaveBeenCalledWith('whatsapp-reserva', { mensagemId: ID }, { chave: `${RESERVA}:remarcacao:2` });
    expect(chamadasDoRepo).toEqual([[ctx, ID, AGORA, expect.any(Function)]]);
  });

  it('fila fora: continua reenfileirada (a linha já é pendente), registra o log e não lança', async () => {
    responder({ resultado: 'reenfileirada', mensagemId: ID, reservaId: RESERVA, tipo: 'confirmacao', revisao: 0 });
    const linhas: string[] = [];
    const r = await reenviarMensagem(ctx, ID, AGORA, { enfileirar: vi.fn().mockRejectedValue(new Error('x')), log: (l) => linhas.push(l) });
    expect(r.resultado).toBe('reenfileirada');
    expect(JSON.parse(linhas[0])).toMatchObject({ evento: 'mensagem.fila_indisponivel', mensagemId: ID });
  });

  it('NaoEncontrado do repositório propaga', async () => {
    respostaDoRepo = async () => {
      throw new NaoEncontrado();
    };
    const erro = await reenviarMensagem(ctx, ID, AGORA, { enfileirar: vi.fn() }).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(NaoEncontrado);
  });
});
