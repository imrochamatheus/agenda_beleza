import pg from 'pg';
import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DefinicaoFila } from '@/worker/handlers/tipos';
import { REGISTRO } from '@/worker/handlers/registry';

import { urlDoWorker } from '../../support/db';
import { abrirBossDeTeste, fecharBoss, iniciarWorkerDeTeste } from '../../support/fila';

// CA-8 (RN-16): agendamentos idempotentes em UTC e remoção de órfãos; CA-7 (parte): as 4 filas existem.
// Roda igual com TZ=America/Sao_Paulo (o fuso do cron é sempre UTC).

let boss: PgBoss;
let sql: pg.Client;

beforeAll(async () => {
  boss = await abrirBossDeTeste();
  sql = new pg.Client({ connectionString: urlDoWorker() });
  await sql.connect();
});

afterAll(async () => {
  await fecharBoss(boss);
  await sql.end();
});

async function agendamentos() {
  const lista = await boss.getSchedules();
  return lista
    .map((s) => ({ name: s.name, key: s.key, cron: s.cron, timezone: s.timezone }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function iniciarEParar(definicoes?: readonly DefinicaoFila[]) {
  const w = await iniciarWorkerDeTeste(definicoes ? { definicoes } : {});
  expect(w.saidas).toEqual([]);
  expect(await w.encerrar()).toBe(0);
  return w;
}

describe('CA-8: agendamentos', () => {
  it('iniciar, parar e iniciar de novo deixa exatamente 2 agendamentos, em UTC, sem duplicata', async () => {
    await iniciarEParar();
    const primeiro = await agendamentos();
    await iniciarEParar();
    const esperado = [
      { name: 'assinatura-prazos', key: '', cron: '*/5 * * * *', timezone: 'UTC' },
      { name: 'reconciliar-mensagens', key: '', cron: '* * * * *', timezone: 'UTC' },
    ];
    expect(primeiro).toEqual(esperado);
    expect(await agendamentos()).toEqual(esperado);

    // CA-7 (A-4 do DBA: a fila interna __pgboss__* criada pelo schedule fica fora da contagem).
    const filas = await sql.query<{ name: string; policy: string }>(
      "SELECT name, policy FROM pgboss.queue WHERE name NOT LIKE '\\_\\_pgboss\\_\\_%' ORDER BY name",
    );
    expect(filas.rows).toEqual([
      { name: 'assinatura-prazos', policy: 'exclusive' },
      { name: 'exemplo', policy: 'standard' },
      { name: 'reconciliar-mensagens', policy: 'exclusive' },
      { name: 'whatsapp-reserva', policy: 'exclusive' },
    ]);
  }, 60_000);

  it('uma definição que perdeu o cron tem o agendamento removido no próximo início', async () => {
    const semCron = REGISTRO.map((d) => (d.fila === 'assinatura-prazos' ? { ...d, cron: undefined } : d));
    await iniciarEParar(semCron);
    expect(await agendamentos()).toEqual([
      { name: 'reconciliar-mensagens', key: '', cron: '* * * * *', timezone: 'UTC' },
    ]);
    // E volta quando o cron reaparece.
    await iniciarEParar();
    expect((await agendamentos()).map((a) => a.name)).toEqual(['assinatura-prazos', 'reconciliar-mensagens']);
  }, 60_000);

  it('um agendamento órfão (fila fora do registro) é removido', async () => {
    await boss.createQueue('fila-antiga');
    await boss.schedule('fila-antiga', '0 * * * *', {}, { tz: 'UTC' });
    expect((await agendamentos()).map((a) => a.name)).toContain('fila-antiga');
    await iniciarEParar();
    expect((await agendamentos()).map((a) => a.name)).toEqual(['assinatura-prazos', 'reconciliar-mensagens']);
  }, 60_000);
});
