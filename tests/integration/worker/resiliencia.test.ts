import pg from 'pg';
import type { PgBoss } from 'pg-boss';
import { afterAll, describe, expect, it } from 'vitest';

import { APLICACAO_FILA } from '@/server/queue/config';
import { criarClienteFila } from '@/server/queue/client';
import { FILA } from '@/server/queue/filas';

import { urlDoWorker } from '../../support/db';
import { abrirBossDeTeste, envDeTeste, esperar, esperarEstado, fecharBoss, iniciarWorkerDeTeste, type WorkerEmTeste } from '../../support/fila';

// CA-12 (RN-13): a queda das conexões do pg-boss não derruba o worker; ele registra worker.erro_fila
// (sem URL nem senha) e volta a processar quando o banco responde.

let w: WorkerEmTeste | undefined;
let boss: PgBoss | undefined;
const cliente = criarClienteFila(envDeTeste());

afterAll(async () => {
  await w?.encerrar();
  await cliente.encerrar();
  await fecharBoss(boss);
});

describe('CA-12: erro do pg-boss não derruba o worker', () => {
  it('pg_terminate_backend nas conexões do worker → worker.erro_fila, processo de pé e job seguinte concluído', async () => {
    w = await iniciarWorkerDeTeste();
    boss = await abrirBossDeTeste();
    const senha = decodeURIComponent(new URL(urlDoWorker()).password);
    const base = new URL(urlDoWorker()).pathname.slice(1);

    const admin = new pg.Client({ connectionString: urlDoWorker() });
    await admin.connect();
    try {
      // R-3: antes de derrubar, confere que as sessões do worker existem com o application_name esperado.
      await esperar(async () => {
        const r = await admin.query(
          'SELECT 1 FROM pg_stat_activity WHERE datname = $1 AND application_name = $2',
          [base, APLICACAO_FILA.worker],
        );
        return (r.rowCount ?? 0) > 0;
      }, 10_000, 'sessões do worker');
      const derrubadas = await admin.query(
        'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND application_name = $2',
        [base, APLICACAO_FILA.worker],
      );
      expect(derrubadas.rowCount).toBeGreaterThan(0);
    } finally {
      await admin.end();
    }

    const erros = await esperar(() => {
      const e = w!.log.doTipo('worker.erro_fila');
      return e.length > 0 ? e : null;
    }, 15_000, 'worker.erro_fila');
    expect(erros[0]).toMatchObject({ nome: expect.any(String), mensagem: expect.any(String) });
    for (const linha of w.log.erros) {
      expect(linha).not.toContain(senha);
      expect(linha).not.toContain('postgresql://');
    }

    const r = await cliente.enfileirar(FILA.exemplo, {});
    if (!r.criado) throw new Error('job não criado');
    await esperarEstado(boss, FILA.exemplo, r.id, 'completed', 20_000);
    expect(w.log.doTipo('worker.job_concluido').map((e) => e.id)).toContain(r.id);
    expect(w.saidas).toEqual([]);
  }, 45_000);
});
