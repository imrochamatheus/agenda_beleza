import { type ChildProcess, execFileSync, spawn } from 'node:child_process';

import type { PgBoss } from 'pg-boss';
import { afterAll, describe, expect, it } from 'vitest';

import { type ClienteFila, criarClienteFila } from '@/server/queue/client';
import { FILA } from '@/server/queue/filas';

import { abrirBossDeTeste, empacotarWorker, envDeTeste, esperar, esperarEstado, fecharBoss } from '../../support/fila';

// CA-4 (RN-4, RN-15): job longo em andamento + SIGTERM real num PROCESSO FILHO que executa o mesmo
// ponto de entrada de produção (src/worker/main.ts empacotado como no build:node). O job conclui e o
// processo sai com 0 em menos de 30 s. Um 2º SIGTERM durante o encerramento é ignorado.

let filho: ChildProcess | undefined;
let pacote: ReturnType<typeof empacotarWorker> | undefined;
let boss: PgBoss | undefined;
let cliente: ClienteFila | undefined;

afterAll(async () => {
  // R-8: nada de processo órfão nem arquivo empacotado esquecido.
  if (filho && filho.exitCode === null && filho.signalCode === null) filho.kill('SIGKILL');
  pacote?.limpar();
  await cliente?.encerrar();
  await fecharBoss(boss);
});

describe('CA-4: SIGTERM com job longo em andamento (processo filho)', () => {
  it('empacotarWorker gera um .mjs que o node aceita', () => {
    pacote = empacotarWorker();
    expect(pacote.arquivo).toMatch(/node_modules[\\/]\.cache[\\/]agenda-beleza[\\/]worker-.*[\\/]worker[\\/]main\.mjs$/);
    expect(() => execFileSync(process.execPath, ['--check', pacote!.arquivo])).not.toThrow();
  }, 30_000);

  it('o job conclui, a saída é 0 em menos de 30 s e os eventos saem na ordem', async () => {
    pacote ??= empacotarWorker();
    let saida = '';
    let erros = '';
    const proc = spawn(process.execPath, [pacote.arquivo], {
      env: envDeTeste({ QUEUE_RETRY_LIMIT: '0' }) as NodeJS.ProcessEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    filho = proc;
    proc.stdout.on('data', (d) => (saida += String(d)));
    proc.stderr.on('data', (d) => (erros += String(d)));
    const fim = new Promise<{ codigo: number | null; sinal: NodeJS.Signals | null }>((ok) =>
      proc.on('exit', (codigo, sinal) => ok({ codigo, sinal })),
    );

    await esperar(() => saida.includes('"worker.iniciado"'), 20_000, `worker.iniciado no filho (stderr: ${erros})`);
    boss = await abrirBossDeTeste();
    cliente = criarClienteFila(envDeTeste());
    const r = await cliente.enfileirar(FILA.exemplo, { esperaMs: 5000 });
    if (!r.criado) throw new Error('job não criado');
    await esperarEstado(boss, FILA.exemplo, r.id, 'active', 15_000);

    const instanteSinal = Date.now();
    proc.kill('SIGTERM');
    await esperar(() => saida.includes('"worker.encerrando"'), 5_000, 'worker.encerrando');
    // 2º sinal durante o encerramento: precisa ser ignorado (com `once`, o Node mataria o processo).
    proc.kill('SIGTERM');
    const { codigo, sinal } = await fim;
    const duracao = Date.now() - instanteSinal;

    expect({ codigo, sinal, erros }).toEqual({ codigo: 0, sinal: null, erros: '' });
    expect(duracao).toBeLessThan(30_000);
    const job = await boss.getJobById(FILA.exemplo, r.id);
    expect(job?.state).toBe('completed');

    const eventos = saida
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { evento: string; id?: string });
    const ordem = eventos
      .filter((e) => ['worker.encerrando', 'worker.job_concluido', 'worker.encerrado'].includes(e.evento))
      .map((e) => e.evento);
    expect(ordem).toEqual(['worker.encerrando', 'worker.job_concluido', 'worker.encerrado']);
    expect(eventos.find((e) => e.evento === 'worker.job_concluido')?.id).toBe(r.id);
  }, 60_000);
});
