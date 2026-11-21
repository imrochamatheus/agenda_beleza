import { randomUUID } from 'node:crypto';

import pg from 'pg';
import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type ClienteFila, criarClienteFila } from '@/server/queue/client';
import { FILA } from '@/server/queue/filas';

import { urlDoWorker } from '../../support/db';
import { abrirBossDeTeste, envDeTeste, esperarEstado, fecharBoss, iniciarWorkerDeTeste, type WorkerEmTeste } from '../../support/fila';

// CA-1 (job enfileirado pela app é processado pelo worker) e CA-7 (stubs registrados, sem efeito em
// `public`), com o registro de PRODUÇÃO, o cliente da app e o pg-boss reais.

let w: WorkerEmTeste;
let boss: PgBoss;
let sql: pg.Client;
let cliente: ClienteFila;

async function tabelasPublic(): Promise<string[]> {
  const r = await sql.query<{ t: string }>(
    "SELECT table_name AS t FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1",
  );
  return r.rows.map((x) => x.t);
}

/**
 * D-024 (CA-27): desde a E7.1 os handlers de mensagem são reais e podem escrever em `mensagem` e
 * `mensagem_tentativa` (e o adaptador simulado em `sim_whatsapp_*`). Todas as demais tabelas de `public`
 * continuam intocadas (RN-17 da D-008); o teste da reconciliação e do envio com dados está em
 * tests/integration/mensagens/envio.test.ts (checksum por tabela).
 */
const PERMITIDAS_PARA_ESCRITA = new Set(['mensagem', 'mensagem_tentativa', 'sim_whatsapp_chamada', 'sim_whatsapp_falha_forcada']);

async function contagensPublic(): Promise<Record<string, number>> {
  const contagens: Record<string, number> = {};
  for (const t of (await tabelasPublic()).filter((x) => !PERMITIDAS_PARA_ESCRITA.has(x))) {
    const r = await sql.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.${sql.escapeIdentifier(t)}`);
    contagens[t] = r.rows[0].n;
  }
  return contagens;
}

let tabelasAntes: string[];
let contagensAntes: Record<string, number>;

beforeAll(async () => {
  sql = new pg.Client({ connectionString: urlDoWorker() });
  await sql.connect();
  tabelasAntes = await tabelasPublic();
  contagensAntes = await contagensPublic();
  w = await iniciarWorkerDeTeste();
  boss = await abrirBossDeTeste();
  cliente = criarClienteFila(envDeTeste());
}, 30_000);

afterAll(async () => {
  await w?.encerrar();
  await cliente?.encerrar();
  await fecharBoss(boss);
  await sql?.end();
});

describe('CA-7: registro de produção', () => {
  it('worker.iniciado lista exatamente as 5 filas, e elas existem no pg-boss', async () => {
    expect(w.saidas).toEqual([]);
    expect(w.log.doTipo('worker.iniciado')).toEqual([
      expect.objectContaining({ filas: ['assinatura-prazos', 'exemplo', 'limpar-rate-limit', 'reconciliar-mensagens', 'whatsapp-reserva'] }),
    ]);
    // A-4 do DBA: a fila interna __pgboss__* (criada pelo schedule) fica fora da contagem.
    const filas = await sql.query<{ name: string }>(
      "SELECT name FROM pgboss.queue WHERE name NOT LIKE '\\_\\_pgboss\\_\\_%' ORDER BY name",
    );
    expect(filas.rows.map((r) => r.name)).toEqual(['assinatura-prazos', 'exemplo', 'limpar-rate-limit', 'reconciliar-mensagens', 'whatsapp-reserva']);
  });
});

describe('CA-1: job enfileirado pela app é processado pelo handler', () => {
  it('exemplo e whatsapp-reserva chegam a completed, com worker.job_concluido das duas filas', async () => {
    const r1 = await cliente.enfileirar(FILA.exemplo, { esperaMs: 10 });
    const r2 = await cliente.enfileirar(FILA.whatsappReserva, { mensagemId: randomUUID() }, { chave: `reserva-${randomUUID()}:confirmacao:1` });
    if (!r1.criado || !r2.criado) throw new Error('job não criado');
    await esperarEstado(boss, FILA.exemplo, r1.id, 'completed');
    await esperarEstado(boss, FILA.whatsappReserva, r2.id, 'completed');
    const concluidos = w.log.doTipo('worker.job_concluido').map((e) => [e.fila, e.id]);
    expect(concluidos).toEqual(expect.arrayContaining([['exemplo', r1.id], ['whatsapp-reserva', r2.id]]));
    expect(w.log.doTipo('worker.exemplo_iniciado')).toEqual([expect.objectContaining({ id: r1.id, esperaMs: 10 })]);
    // O job está no schema pgboss.
    const noSchema = await sql.query('SELECT 1 FROM pgboss.job WHERE id = $1', [r1.id]);
    expect(noSchema.rowCount).toBe(1);
  }, 30_000);

  it('CA-7/RN-17 (ajustado na D-024): um job em cada handler conclui, sem tabela nova nem linha alterada em public fora de mensagem e mensagem_tentativa', async () => {
    const jobs: Array<[string, string]> = [];
    for (const [fila, payload, chave] of [
      [FILA.assinaturaPrazos, {}, undefined],
      [FILA.reconciliarMensagens, {}, undefined],
      [FILA.whatsappReserva, { mensagemId: randomUUID() }, `stub-${randomUUID()}`],
    ] as const) {
      const r = await cliente.enfileirar(fila, payload as never, chave ? { chave } : {});
      // Um disparo do cron pode já ter criado o job da fila exclusive: então espera esse.
      if (r.criado) jobs.push([fila, r.id]);
      else {
        const pendente = await sql.query<{ id: string }>(
          "SELECT id FROM pgboss.job WHERE name = $1 AND state <= 'active' LIMIT 1",
          [fila],
        );
        if (pendente.rows[0]) jobs.push([fila, pendente.rows[0].id]);
      }
    }
    for (const [fila, id] of jobs) await esperarEstado(boss, fila, id, 'completed');
    expect(jobs.map(([f]) => f).sort()).toEqual(['assinatura-prazos', 'reconciliar-mensagens', 'whatsapp-reserva']);
    expect(await tabelasPublic()).toEqual(tabelasAntes);
    expect(await contagensPublic()).toEqual(contagensAntes);
  }, 30_000);
});
