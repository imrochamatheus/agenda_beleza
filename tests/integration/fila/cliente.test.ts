import { randomUUID } from 'node:crypto';

import pg from 'pg';
import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type ClienteFila, criarClienteFila } from '@/server/queue/client';
import { ErroPayloadInvalido } from '@/server/queue/erros';
import { CONTRATOS, FILA, type NomeFila } from '@/server/queue/filas';

import { urlDoWorker } from '../../support/db';
import { abrirBossDeTeste, envDeTeste, esperarEstado, fecharBoss } from '../../support/fila';

// Cliente da app contra o PostgreSQL e o pg-boss reais, sem worker consumindo: CA-9 (singletonKey com
// a política exclusive), CA-10 (payload recusado não cria job) e CA-11 (retry do ambiente no job).
// As filas são criadas aqui com a política do contrato (no sistema, quem as cria é o worker, D-6).

let boss: PgBoss;
let sql: pg.Client;
const clientes: ClienteFila[] = [];

function cliente(extra: Record<string, string> = {}): ClienteFila {
  const c = criarClienteFila(envDeTeste(extra));
  clientes.push(c);
  return c;
}

async function totalDeJobs(): Promise<number> {
  const r = await sql.query<{ n: number }>('SELECT count(*)::int AS n FROM pgboss.job');
  return r.rows[0].n;
}

/** Busca (fetch) os jobs pendentes da fila até o `id` ficar ativo, como um worker faria. */
async function ativar(fila: NomeFila, id: string): Promise<void> {
  for (let i = 0; i < 20; i++) {
    const jobs = await boss.fetch(fila, { batchSize: 50 });
    if (jobs.some((j) => j.id === id)) return;
  }
  throw new Error(`job ${id} não foi buscado`);
}

beforeAll(async () => {
  boss = await abrirBossDeTeste();
  for (const [nome, contrato] of Object.entries(CONTRATOS)) {
    await boss.createQueue(nome, { policy: contrato.politica });
  }
  sql = new pg.Client({ connectionString: urlDoWorker() });
  await sql.connect();
});

afterAll(async () => {
  await Promise.all(clientes.map((c) => c.encerrar()));
  await fecharBoss(boss);
  await sql.end();
});

describe('CA-9: singletonKey na fila whatsapp-reserva (exclusive)', () => {
  it('a mesma chave não cria um 2º job enquanto o 1º está pendente; outra chave cria', async () => {
    const c = cliente();
    const chave = `reserva-${randomUUID()}:confirmacao:1`;
    const antes = await totalDeJobs();
    const r1 = await c.enfileirar(FILA.whatsappReserva, { mensagemId: randomUUID() }, { chave });
    const r2 = await c.enfileirar(FILA.whatsappReserva, { mensagemId: randomUUID() }, { chave });
    const r3 = await c.enfileirar(FILA.whatsappReserva, { mensagemId: randomUUID() }, { chave: `${chave}-outra` });
    expect(r1).toEqual({ criado: true, id: expect.any(String) });
    expect(r2).toEqual({ criado: false, motivo: 'chave_em_uso' });
    expect(r3).toEqual({ criado: true, id: expect.any(String) });
    expect(await totalDeJobs()).toBe(antes + 2);
  });

  it('enfileiramentos simultâneos com a mesma chave criam no máximo 1 job', async () => {
    const c = cliente();
    const chave = `simultanea-${randomUUID()}`;
    const resultados = await Promise.all(
      Array.from({ length: 8 }, () => c.enfileirar(FILA.whatsappReserva, { mensagemId: randomUUID() }, { chave })),
    );
    expect(resultados.filter((r) => r.criado)).toHaveLength(1);
    expect(resultados.filter((r) => !r.criado)).toHaveLength(7);
    const r = await sql.query('SELECT 1 FROM pgboss.job WHERE singleton_key = $1', [chave]);
    expect(r.rowCount).toBe(1);
  });

  it('depois que o job da chave termina concluído, a mesma chave cria um novo job', async () => {
    const c = cliente();
    const chave = `concluida-${randomUUID()}`;
    const r1 = await c.enfileirar(FILA.whatsappReserva, { mensagemId: randomUUID() }, { chave });
    if (!r1.criado) throw new Error('job não criado');
    await ativar(FILA.whatsappReserva, r1.id);
    await boss.complete(FILA.whatsappReserva, r1.id);
    await esperarEstado(boss, FILA.whatsappReserva, r1.id, 'completed');
    const r2 = await c.enfileirar(FILA.whatsappReserva, { mensagemId: randomUUID() }, { chave });
    expect(r2).toEqual({ criado: true, id: expect.any(String) });
    expect(r2.criado && r2.id).not.toBe(r1.id);
  });

  it('com QUEUE_RETRY_LIMIT=0, depois que o job da chave falha, a mesma chave cria um novo job', async () => {
    const c = cliente({ QUEUE_RETRY_LIMIT: '0' });
    const chave = `falha-${randomUUID()}`;
    const r1 = await c.enfileirar(FILA.whatsappReserva, { mensagemId: randomUUID() }, { chave });
    if (!r1.criado) throw new Error('job não criado');
    // Ainda pendente: a chave está em uso.
    expect(await c.enfileirar(FILA.whatsappReserva, { mensagemId: randomUUID() }, { chave })).toEqual({
      criado: false,
      motivo: 'chave_em_uso',
    });
    await ativar(FILA.whatsappReserva, r1.id);
    await boss.fail(FILA.whatsappReserva, r1.id, { motivo: 'teste' });
    await esperarEstado(boss, FILA.whatsappReserva, r1.id, 'failed');
    const r2 = await c.enfileirar(FILA.whatsappReserva, { mensagemId: randomUUID() }, { chave });
    expect(r2).toEqual({ criado: true, id: expect.any(String) });
  });
});

describe('CA-10: payload fora do contrato é recusado e não cria job', () => {
  const casos: Array<[string, NomeFila, unknown, string[]]> = [
    ['campo extra (telefone)', FILA.whatsappReserva, { mensagemId: randomUUID(), telefone: '+5511999998888' }, ['telefone']],
    ['id que não é UUID', FILA.whatsappReserva, { mensagemId: 'reserva-1' }, ['mensagemId']],
    ['payload que não é objeto', FILA.whatsappReserva, 'texto', ['(raiz)']],
    ['campo em fila de cron', FILA.assinaturaPrazos, { salaoId: randomUUID() }, ['salaoId']],
    ['esperaMs fora da faixa', FILA.exemplo, { esperaMs: 60_001 }, ['esperaMs']],
  ];

  it.each(casos)('%s', async (_nome, fila, payload, campos) => {
    const c = cliente();
    const antes = await totalDeJobs();
    const falha = c.enfileirar(fila, payload as never, { chave: 'k' });
    await expect(falha).rejects.toBeInstanceOf(ErroPayloadInvalido);
    await expect(falha).rejects.toMatchObject({ fila, campos });
    expect(await totalDeJobs()).toBe(antes);
  });

  it('chave ausente em whatsapp-reserva é recusada e não cria job', async () => {
    const antes = await totalDeJobs();
    await expect(cliente().enfileirar(FILA.whatsappReserva, { mensagemId: randomUUID() })).rejects.toMatchObject({
      campos: ['(chave)'],
    });
    expect(await totalDeJobs()).toBe(antes);
  });
});

describe('CA-11: política de retry do ambiente gravada no job', () => {
  it('QUEUE_RETRY_LIMIT=3, QUEUE_RETRY_DELAY_SECONDS=7, QUEUE_RETRY_BACKOFF=false', async () => {
    const c = cliente({ QUEUE_RETRY_LIMIT: '3', QUEUE_RETRY_DELAY_SECONDS: '7', QUEUE_RETRY_BACKOFF: 'false' });
    const r = await c.enfileirar(FILA.exemplo, { esperaMs: 0 });
    if (!r.criado) throw new Error('job não criado');
    const linha = await sql.query(
      'SELECT retry_limit, retry_delay, retry_backoff, data FROM pgboss.job WHERE id = $1',
      [r.id],
    );
    expect(linha.rows).toEqual([{ retry_limit: 3, retry_delay: 7, retry_backoff: false, data: { esperaMs: 0 } }]);
  });

  it('com os padrões (sem as variáveis) grava 4, 30 e true', async () => {
    const c = criarClienteFila({ DATABASE_URL: urlDoWorker() });
    clientes.push(c);
    const r = await c.enfileirar(FILA.exemplo, {});
    if (!r.criado) throw new Error('job não criado');
    const linha = await sql.query('SELECT retry_limit, retry_delay, retry_backoff FROM pgboss.job WHERE id = $1', [r.id]);
    expect(linha.rows).toEqual([{ retry_limit: 4, retry_delay: 30, retry_backoff: true }]);
  });
});
