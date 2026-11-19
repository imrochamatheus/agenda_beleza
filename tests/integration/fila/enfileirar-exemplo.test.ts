import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { executarEnfileirarExemplo } from '@/server/queue/enfileirar-exemplo';
import { FILA } from '@/server/queue/filas';

import { abrirBossDeTeste, envDeTeste, fecharBoss } from '../../support/fila';

// Script de verificação manual (D-008 §3.9) contra o PostgreSQL real. Ordem importa: o 1º caso roda
// antes de a fila existir nesta base (o worker nunca rodou).

let boss: PgBoss;

beforeAll(async () => {
  boss = await abrirBossDeTeste();
});

afterAll(async () => {
  await fecharBoss(boss);
});

function saida() {
  const log: string[] = [];
  const error: string[] = [];
  return { log, error, s: { log: (m: string) => void log.push(m), error: (m: string) => void error.push(m) } };
}

describe('executarEnfileirarExemplo', () => {
  it('sem a fila (worker nunca rodou) → 1 com a mensagem do ErroFilaIndisponivel', async () => {
    const o = saida();
    await expect(executarEnfileirarExemplo(['10'], envDeTeste(), o.s)).resolves.toBe(1);
    expect(o.error).toEqual(['enfileirar-exemplo: Fila "exemplo" indisponível (fila_inexistente)']);
    expect(o.log).toEqual([]);
  });

  it.each([['abc'], ['-1'], ['60001'], ['1.5'], ['1', '2']])('argumento inválido %j → 1, sem acessar o banco', async (...args) => {
    const o = saida();
    await expect(executarEnfileirarExemplo(args, {}, o.s)).resolves.toBe(1);
    expect(o.error[0]).toMatch(/argumento inválido; uso: enfileirar-exemplo/);
  });

  it('com a fila criada → 0, imprime o id e o job tem o esperaMs pedido', async () => {
    await boss.createQueue(FILA.exemplo);
    const o = saida();
    await expect(executarEnfileirarExemplo(['20000'], envDeTeste(), o.s)).resolves.toBe(0);
    const evento = JSON.parse(o.log[0]);
    expect(evento).toEqual({ evento: 'fila.enfileirado', fila: 'exemplo', id: expect.any(String), esperaMs: 20000 });
    const job = await boss.getJobById(FILA.exemplo, evento.id);
    expect(job).toMatchObject({ state: 'created', data: { esperaMs: 20000 } });
  });

  it('sem argumento usa esperaMs 0', async () => {
    const o = saida();
    await expect(executarEnfileirarExemplo([], envDeTeste(), o.s)).resolves.toBe(0);
    expect(JSON.parse(o.log[0])).toMatchObject({ esperaMs: 0 });
  });

  it('erro inesperado do cliente é propagado e o cliente é encerrado', async () => {
    let encerrado = false;
    const cliente = {
      enfileirar: async () => {
        throw new TypeError('inesperado');
      },
      encerrar: async () => {
        encerrado = true;
      },
    };
    await expect(executarEnfileirarExemplo([], envDeTeste(), saida().s, cliente)).rejects.toThrow('inesperado');
    expect(encerrado).toBe(true);
  });

  it('resultado sem job criado (não ocorre com a política standard) é tratado como erro', async () => {
    const cliente = {
      enfileirar: async () => ({ criado: false as const, motivo: 'chave_em_uso' as const }),
      encerrar: async () => undefined,
    };
    await expect(executarEnfileirarExemplo([], envDeTeste(), saida().s, cliente)).rejects.toThrow('job não criado');
  });
});
