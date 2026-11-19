import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { criarClienteFila } from '@/server/queue/client';
import { FILA } from '@/server/queue/filas';

import { urlComBase } from '../../support/banco';
import { urlDoWorker } from '../../support/db';
import { abrirBossDeTeste, envDeTeste, esperarEstado, fecharBoss, iniciarWorkerDeTeste } from '../../support/fila';

// CA-13 (falha no start), CA-14 (encerramento forçado com prazo curto) e R-2 (política divergente),
// com o pg-boss real e o worker no processo do teste.

let boss: PgBoss;
const cliente = criarClienteFila(envDeTeste());

beforeAll(async () => {
  boss = await abrirBossDeTeste();
});

afterAll(async () => {
  await cliente.encerrar();
  await fecharBoss(boss);
});

describe('início', () => {
  it('CA-13: base inexistente → worker.falha_inicio sem a senha e saída 1', async () => {
    const url = urlComBase(urlDoWorker(), 'agenda_beleza_base_inexistente');
    const senha = decodeURIComponent(new URL(url).password);
    const w = await iniciarWorkerDeTeste({ env: { DATABASE_URL: url } });
    expect(w.saidas).toEqual([1]);
    const [falha] = w.log.doTipo('worker.falha_inicio');
    expect(falha).toMatchObject({ codigo: '3D000' });
    expect(w.log.doTipo('worker.iniciado')).toEqual([]);
    for (const linha of [...w.log.linhas, ...w.log.erros]) expect(linha).not.toContain(senha);
  }, 30_000);

  it('R-2: fila existente com política divergente → worker.falha_inicio (politica_divergente) e saída 1', async () => {
    await boss.createQueue(FILA.whatsappReserva, { policy: 'standard' });
    try {
      const w = await iniciarWorkerDeTeste();
      expect(w.saidas).toEqual([1]);
      expect(w.log.doTipo('worker.falha_inicio')).toEqual([
        expect.objectContaining({ motivo: 'politica_divergente', fila: 'whatsapp-reserva', esperada: 'exclusive', atual: 'standard' }),
      ]);
    } finally {
      await boss.deleteQueue(FILA.whatsappReserva);
    }
  }, 30_000);
});

describe('CA-14: prazo de encerramento estourado', () => {
  it('job de 5 s com prazo de 2 s → worker.encerramento_forcado, saída 1 e job de volta em retry', async () => {
    const w = await iniciarWorkerDeTeste({ timeoutEncerramentoMs: 2000 });
    expect(w.saidas).toEqual([]);
    const r = await cliente.enfileirar(FILA.exemplo, { esperaMs: 5000 });
    if (!r.criado) throw new Error('job não criado');
    await esperarEstado(boss, FILA.exemplo, r.id, 'active');

    const inicio = Date.now();
    w.sinais.emit('SIGTERM');
    w.sinais.emit('SIGTERM');
    const codigo = await w.controle.encerrar('SIGTERM');
    const duracao = Date.now() - inicio;
    expect(codigo).toBe(1);
    expect(w.saidas).toEqual([1]);
    expect(duracao).toBeLessThan(4500);
    expect(w.log.doTipo('worker.encerramento_forcado')).toHaveLength(1);
    expect(w.log.doTipo('worker.encerrado')).toEqual([]);
    expect(w.log.doTipo('worker.encerrando')).toEqual([expect.objectContaining({ sinal: 'SIGTERM' })]);
    // R-7/D-9: o job interrompido consome uma tentativa e volta para nova tentativa.
    const job = await boss.getJobById(FILA.exemplo, r.id);
    expect(job).toMatchObject({ state: 'retry', retryCount: 0 });
    expect(JSON.stringify(job?.output)).toContain('pg-boss shut down while active');
  }, 30_000);
});
