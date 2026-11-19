import { randomUUID } from 'node:crypto';

import type { PgBoss } from 'pg-boss';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { type ClienteFila, criarClienteFila } from '@/server/queue/client';
import { FILA } from '@/server/queue/filas';
import { definirHandler } from '@/worker/handlers/tipos';
import { whatsappReserva } from '@/worker/handlers/whatsapp-reserva';

import {
  abrirBossDeTeste,
  envDeTeste,
  esperar,
  esperarEstado,
  fecharBoss,
  iniciarWorkerDeTeste,
  type WorkerEmTeste,
} from '../../support/fila';

// CA-2 (RN-2, RN-9; ajuste R-1 do design) e CA-3 (RN-3, RN-13), com o pg-boss real e o worker no
// processo do teste. Atraso de retry de 1 s; espera por polling com prazo.

const abertos: Array<{ encerrar(): Promise<unknown> }> = [];
let boss: PgBoss | undefined;

async function bossDeTeste(): Promise<PgBoss> {
  boss ??= await abrirBossDeTeste();
  return boss;
}

function cliente(extra: Record<string, string>): ClienteFila {
  const c = criarClienteFila(envDeTeste(extra));
  abertos.push(c);
  return c;
}

afterEach(async () => {
  for (const a of abertos.splice(0).reverse()) await a.encerrar();
});

afterAll(async () => {
  await fecharBoss(boss);
});

describe('CA-2: falha nas 2 primeiras execuções, conclui na 3ª com intervalos crescentes', () => {
  it('3 execuções, completed, Δ1 ≥ 1 s, Δ2 ≥ 2 s e atraso agendado crescente', async () => {
    const env = { QUEUE_RETRY_LIMIT: '4', QUEUE_RETRY_DELAY_SECONDS: '1', QUEUE_RETRY_BACKOFF: 'true' };
    const execucoes: Array<{ inicio: number; agendadoPara: number; falha?: number }> = [];
    const definicoes = [
      definirHandler(FILA.exemplo, {
        async processar(_p, ctx) {
          const registro: (typeof execucoes)[number] = { inicio: Date.now(), agendadoPara: ctx.agendadoPara.getTime() };
          execucoes.push(registro);
          if (execucoes.length <= 2) {
            registro.falha = Date.now();
            throw new Error(`falha proposital ${execucoes.length}`);
          }
        },
      }),
    ];
    const w: WorkerEmTeste = await iniciarWorkerDeTeste({ env, definicoes });
    abertos.push(w);
    const r = await cliente(env).enfileirar(FILA.exemplo, {});
    if (!r.criado) throw new Error('job não criado');

    const final = await esperarEstado(await bossDeTeste(), FILA.exemplo, r.id, ['completed', 'failed'], 20_000);
    expect(final.state).toBe('completed');
    expect(final.retryCount).toBe(2);
    expect(execucoes).toHaveLength(3);

    const [e1, e2, e3] = execucoes;
    const delta1 = e2.inicio - e1.inicio;
    const delta2 = e3.inicio - e2.inicio;
    expect(delta1).toBeGreaterThanOrEqual(1000);
    expect(delta2).toBeGreaterThanOrEqual(2000);
    // R-1: "intervalos crescentes" medidos sobre os atrasos AGENDADOS pelo pg-boss (sem a granularidade
    // do polling): início permitido da tentativa k+1 menos o instante da falha k.
    const atraso1 = e2.agendadoPara - e1.falha!;
    const atraso2 = e3.agendadoPara - e2.falha!;
    expect(atraso1).toBeGreaterThanOrEqual(950);
    expect(atraso2).toBeGreaterThan(atraso1);
    expect(w.log.doTipo('worker.job_falhou').map((e) => e.tentativa)).toEqual([1, 2]);
    expect(w.log.doTipo('worker.job_concluido')).toEqual([expect.objectContaining({ fila: 'exemplo', id: r.id, tentativa: 3 })]);
    expect(w.saidas).toEqual([]);
  }, 30_000);
});

describe('CA-3: handler que sempre falha esgota as tentativas e o worker continua', () => {
  it('3 execuções, failed consultável com o último erro, logs sem payload e outros jobs concluem', async () => {
    const env = { QUEUE_RETRY_LIMIT: '2', QUEUE_RETRY_DELAY_SECONDS: '1', QUEUE_RETRY_BACKOFF: 'false' };
    let falhar = true;
    let execucoes = 0;
    const definicoes = [
      definirHandler(FILA.exemplo, {
        async processar() {
          if (!falhar) return;
          execucoes++;
          throw new Error(`falha sempre ${execucoes}`);
        },
      }),
      whatsappReserva,
    ];
    const w = await iniciarWorkerDeTeste({ env, definicoes });
    abertos.push(w);
    const c = cliente(env);
    const r = await c.enfileirar(FILA.exemplo, { esperaMs: 4321 });
    if (!r.criado) throw new Error('job não criado');

    const b = await bossDeTeste();
    const falho = await esperarEstado(b, FILA.exemplo, r.id, ['failed', 'completed'], 20_000);
    expect(falho.state).toBe('failed');
    expect(falho.retryCount).toBe(2);
    expect(falho.retryLimit).toBe(2);
    expect(falho.output).toMatchObject({ name: 'Error', message: 'falha sempre 3' });
    expect(execucoes).toBe(3);

    const falhas = await esperar(() => {
      const f = w.log.doTipo('worker.job_falhou');
      return f.length === 3 ? f : null;
    });
    expect(falhas.map((f) => [f.fila, f.id, f.tentativa])).toEqual([
      ['exemplo', r.id, 1],
      ['exemplo', r.id, 2],
      ['exemplo', r.id, 3],
    ]);
    expect(falhas.map((f) => (f.erro as { mensagem: string }).mensagem)).toEqual([
      'falha sempre 1',
      'falha sempre 2',
      'falha sempre 3',
    ]);
    for (const linha of w.log.erros) expect(linha).not.toContain('4321');

    // Sem reiniciar: um job de outra fila e outro da mesma fila (agora com sucesso) concluem.
    const outro = await c.enfileirar(FILA.whatsappReserva, { mensagemId: randomUUID() }, { chave: randomUUID() });
    falhar = false;
    const mesmo = await c.enfileirar(FILA.exemplo, {});
    if (!outro.criado || !mesmo.criado) throw new Error('job não criado');
    await esperarEstado(b, FILA.whatsappReserva, outro.id, 'completed');
    await esperarEstado(b, FILA.exemplo, mesmo.id, 'completed');
    expect(w.saidas).toEqual([]);
  }, 30_000);
});
