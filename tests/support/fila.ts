import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { EventEmitter } from 'node:events';

import { PgBoss, type JobWithMetadata } from 'pg-boss';

import { SCHEMA_FILA } from '../../src/server/queue/config';
import type { DefinicaoFila } from '../../src/worker/handlers/tipos';
import { type ControleWorker, type DependenciasWorker, iniciarWorker } from '../../src/worker/iniciar';

import { planoDaExecucao, urlDoWorker } from './db';

// Auxiliares dos testes de fila (D-008 §3.10). Só para testes: nada aqui é código de produção.

const RAIZ = fileURLToPath(new URL('../..', import.meta.url));

export type EstadoJob = JobWithMetadata['state'];

/**
 * Um PgBoss para inspecionar e manipular jobs (getJobById, fetch, fail, createQueue, getSchedules), sem
 * migrar, supervisionar nem agendar. Já iniciado. Feche com `stop({ graceful: false, close: true })`.
 */
export async function abrirBossDeTeste(url: string = urlDoWorker()): Promise<PgBoss> {
  const boss = new PgBoss({
    connectionString: url,
    schema: SCHEMA_FILA,
    max: 2,
    application_name: 'agenda-beleza:teste',
    migrate: false,
    supervise: false,
    schedule: false,
    registerInstance: false,
  });
  boss.on('error', () => undefined);
  await boss.start();
  return boss;
}

/** Fecha o boss de inspeção sem propagar erro (afterAll). */
export async function fecharBoss(boss: PgBoss | undefined): Promise<void> {
  await boss?.stop({ graceful: false, close: true }).catch(() => undefined);
}

/** Polling com prazo (nunca sleep fixo). Devolve o valor verdadeiro da condição. */
export async function esperar<T>(
  condicao: () => Promise<T> | T,
  prazoMs = 15_000,
  descricao = 'condição',
): Promise<NonNullable<T>> {
  const limite = Date.now() + prazoMs;
  for (;;) {
    const valor = await condicao();
    if (valor) return valor as NonNullable<T>;
    if (Date.now() > limite) throw new Error(`Tempo esgotado (${prazoMs} ms) esperando ${descricao}`);
    await new Promise((ok) => setTimeout(ok, 50));
  }
}

/** Espera o job chegar a um dos estados e o devolve. */
export async function esperarEstado(
  boss: PgBoss,
  fila: string,
  id: string,
  estados: EstadoJob | EstadoJob[],
  prazoMs = 15_000,
): Promise<JobWithMetadata<unknown>> {
  const alvo = Array.isArray(estados) ? estados : [estados];
  let ultimo: string | undefined;
  try {
    return await esperar(
      async () => {
        const job = await boss.getJobById<unknown>(fila, id);
        ultimo = job?.state;
        return job && alvo.includes(job.state) ? job : null;
      },
      prazoMs,
      `o job ${fila}/${id} em ${alvo.join('|')}`,
    );
  } catch (e) {
    throw new Error(`${(e as Error).message} (último estado: ${ultimo ?? 'inexistente'})`);
  }
}

export type Evento = { evento: string; [campo: string]: unknown };

/** Captura as linhas JSON do worker em teste. */
export function capturarLog() {
  const linhas: string[] = [];
  const erros: string[] = [];
  return {
    log: (linha: string) => void linhas.push(linha),
    erro: (linha: string) => void erros.push(linha),
    linhas,
    erros,
    /** Eventos de log e de erro, na ordem de cada fluxo (log primeiro). */
    eventos(): Evento[] {
      return [...linhas, ...erros].map((l) => JSON.parse(l) as Evento);
    },
    doTipo(evento: string): Evento[] {
      return this.eventos().filter((e) => e.evento === evento);
    },
  };
}

/** Ambiente do worker/cliente em teste: base do worker do Vitest e atraso de retry de 1 s (RN-2). */
export function envDeTeste(extra: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return { ...process.env, DATABASE_URL: urlDoWorker(), QUEUE_RETRY_DELAY_SECONDS: '1', ...extra };
}

/**
 * Empacota src/worker/main.ts como o `npm run build:node` (mesmos argumentos, lidos do package.json),
 * trocando só a pasta de saída (node_modules/.cache, com nome único por execução, worker e processo)
 * e a extensão (.mjs: o Node não sobe além de node_modules/ para achar o "type": "module").
 * Sem shell: o caminho do repositório tem espaço e acento.
 */
export function empacotarWorker(): { arquivo: string; limpar(): void } {
  const pacote = JSON.parse(readFileSync(join(RAIZ, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };
  const [binario, ...args] = pacote.scripts['build:node'].split(/\s+/);
  if (binario !== 'esbuild' || !args.includes('--outdir=dist')) {
    throw new Error('O script build:node mudou de forma: atualize empacotarWorker (tests/support/fila.ts)');
  }
  const pasta = join(
    RAIZ,
    'node_modules',
    '.cache',
    'agenda-beleza',
    `worker-${planoDaExecucao().exec}-${process.env.VITEST_POOL_ID}-${process.pid}`,
  );
  const r = spawnSync(
    join(RAIZ, 'node_modules', '.bin', 'esbuild'),
    [...args.map((a) => (a === '--outdir=dist' ? `--outdir=${pasta}` : a)), '--out-extension:.js=.mjs', '--log-level=warning'],
    { cwd: RAIZ, encoding: 'utf8' },
  );
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`esbuild falhou (status ${r.status}):\n${r.stderr}`);
  return {
    arquivo: join(pasta, 'worker', 'main.mjs'),
    limpar: () => rmSync(pasta, { recursive: true, force: true }),
  };
}

export type WorkerEmTeste = {
  controle: ControleWorker;
  log: ReturnType<typeof capturarLog>;
  sinais: EventEmitter;
  /** Códigos passados a `sair` (o processo do teste nunca sai). */
  saidas: number[];
  /** Encerra (idempotente) e devolve o código. */
  encerrar(): Promise<number>;
};

/**
 * Inicia o worker NO PROCESSO do teste (D-008 §5 "Worker em teste"): base do worker do Vitest, atraso
 * de retry de 1 s, intervalo de busca de 0,5 s e log capturado. Espera o início terminar.
 */
export async function iniciarWorkerDeTeste(
  opcoes: {
    env?: Record<string, string | undefined>;
    definicoes?: readonly DefinicaoFila[];
    timeoutEncerramentoMs?: number;
    log?: ReturnType<typeof capturarLog>;
  } & Partial<Pick<DependenciasWorker, 'intervaloMs'>> = {},
): Promise<WorkerEmTeste> {
  const log = opcoes.log ?? capturarLog();
  const sinais = new EventEmitter();
  const saidas: number[] = [];
  const controle = iniciarWorker({
    env: envDeTeste(opcoes.env),
    log: log.log,
    erro: log.erro,
    sinais: sinais as unknown as DependenciasWorker['sinais'],
    sair: (c) => void saidas.push(c),
    intervaloBuscaSegundos: 0.5,
    ...(opcoes.definicoes ? { definicoes: opcoes.definicoes } : {}),
    ...(opcoes.timeoutEncerramentoMs ? { timeoutEncerramentoMs: opcoes.timeoutEncerramentoMs } : {}),
    ...(opcoes.intervaloMs ? { intervaloMs: opcoes.intervaloMs } : {}),
  });
  await controle.pronto;
  return { controle, log, sinais, saidas, encerrar: () => controle.encerrar('teste') };
}
