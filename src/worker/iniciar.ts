import { type ConstructorOptions, type JobWithMetadata, PgBoss } from 'pg-boss';

import { type Env, ErroDeAmbiente, modosAtivos, validarEnv } from '@/server/env';
import { opcoesPgBoss, politicaDeRetry } from '@/server/queue/config';
import { descreverErroSeguro } from '@/server/queue/erros';

import { REGISTRO } from './handlers/registry';
import type { ContextoJob, DefinicaoFila } from './handlers/tipos';

// Worker da fila (D-008 §3.6; substitui o stub da E0.2). Processo separado do Next.js, mesmo banco;
// o pg-boss fica no schema `pgboss` e só este processo o instala ou migra (D-6).

export const INTERVALO_HEARTBEAT_MS = 30_000;
/** RN-4: menor que o `stop_grace_period: 30s` do compose (o teste do compose compara). */
export const TIMEOUT_ENCERRAMENTO_MS = 25_000;

/** O subconjunto do PgBoss usado pelo worker (permite o dublê dos testes unitários). */
export type FilaWorker = Pick<
  PgBoss,
  'on' | 'start' | 'stop' | 'createQueue' | 'getQueue' | 'updateQueue' | 'work' | 'schedule' | 'unschedule' | 'getSchedules'
>;

type Sinal = 'SIGTERM' | 'SIGINT';

export interface DependenciasWorker {
  env: Record<string, string | undefined>;
  /** Uma linha JSON por evento. */
  log: (linha: string) => void;
  erro: (linha: string) => void;
  /** `on`, e não `once`: o 2º sinal precisa de ouvinte para ser ignorado (sem ouvinte, o Node mata o processo). */
  sinais: { on(evento: Sinal, fn: () => void): unknown };
  sair: (codigo: number) => void;
  /** Intervalo do heartbeat (padrão INTERVALO_HEARTBEAT_MS). */
  intervaloMs?: number;
  /** Filas registradas (padrão: REGISTRO de produção). */
  definicoes?: readonly DefinicaoFila[];
  /** Construtor do pg-boss (padrão: `new PgBoss(opcoes)`). */
  criarFila?: (opcoes: ConstructorOptions) => FilaWorker;
  /** D-10: intervalo de busca; padrão da biblioteca (2 s) em produção, 0,5 s nos testes. */
  intervaloBuscaSegundos?: number;
  /** Prazo do encerramento gracioso (padrão TIMEOUT_ENCERRAMENTO_MS). */
  timeoutEncerramentoMs?: number;
}

export interface ControleWorker {
  /** Resolve quando o início termina (sucesso ou falha já tratada). */
  pronto: Promise<void>;
  /** Mesmo caminho do sinal; devolve o código de saída. Idempotente. */
  encerrar(origem?: Sinal | 'teste'): Promise<number>;
}

/** Prefixo das filas internas do pg-boss (ex.: `__pgboss__send-it`, criada com schedule: true). */
const PREFIXO_INTERNO = '__pgboss__';
const LIMITE_MENSAGEM = 300;

class FalhaDeInicio extends Error {
  constructor(readonly campos: Record<string, unknown>) {
    super('falha de início');
  }
}

export function iniciarWorker(deps: DependenciasWorker): ControleWorker {
  const emitir = (saida: (linha: string) => void, evento: string, campos: Record<string, unknown> = {}) =>
    saida(JSON.stringify({ evento, em: new Date().toISOString(), ...campos }));
  const log = (evento: string, campos?: Record<string, unknown>) => emitir(deps.log, evento, campos);
  const erro = (evento: string, campos?: Record<string, unknown>) => emitir(deps.erro, evento, campos);

  let env: Env;
  try {
    env = validarEnv(deps.env);
  } catch (falha) {
    const variaveis = falha instanceof ErroDeAmbiente ? falha.variaveis : [];
    erro('worker.ambiente_invalido', { variaveis });
    deps.sair(1);
    return { pronto: Promise.resolve(), encerrar: async () => 1 };
  }

  // Modo ativo de cada adaptador, sem nenhum valor de configuração (D-007 RN-14).
  log('worker.adaptadores', { ...modosAtivos(env) });

  const url = env.DATABASE_URL;
  const retry = politicaDeRetry(env);
  const definicoes = deps.definicoes ?? REGISTRO;
  const timeoutEncerramento = deps.timeoutEncerramentoMs ?? TIMEOUT_ENCERRAMENTO_MS;
  const criar = deps.criarFila ?? ((opcoes: ConstructorOptions) => new PgBoss(opcoes));

  let parado = false;
  /** Código de saída já emitido (falha de início ou encerramento). */
  let saiu: number | null = null;
  let intervalo: ReturnType<typeof setInterval> | undefined;
  let encerrando: Promise<number> | null = null;
  /** Jobs cujo handler ainda não terminou. */
  let emAndamento = 0;
  /** Jobs cujo sinal abortou com o handler ainda rodando, depois do pedido de encerramento. */
  let interrompidos = 0;

  const sair = (codigo: number) => {
    if (saiu !== null) return;
    saiu = codigo;
    deps.sair(codigo);
  };

  const fila = criar(opcoesPgBoss(url, 'worker'));
  // R-11: sem ouvinte, um `error` do EventEmitter derrubaria o processo (RN-13).
  fila.on('error', (e) => erro('worker.erro_fila', descreverErroSeguro(e, url)));
  fila.on('warning', (aviso) =>
    log('worker.aviso_fila', { mensagem: descreverErroSeguro(new Error(aviso.message), url).mensagem }),
  );

  const processarJob = async (def: DefinicaoFila, job: JobWithMetadata<unknown>) => {
    emAndamento++;
    const base = { fila: def.fila, id: job.id, tentativa: job.retryCount + 1 };
    const aoAbortar = () => {
      if (parado) interrompidos++;
    };
    job.signal.addEventListener('abort', aoAbortar, { once: true });
    try {
      const ctx: ContextoJob = {
        ...base,
        tentativasMaximas: job.retryLimit + 1,
        agendadoPara: job.startAfter,
        sinal: job.signal,
        log,
      };
      await def.processar(def.validarPayload(job.data), ctx);
      log('worker.job_concluido', base);
    } catch (falha) {
      // Nunca o payload (RN-13): só o nome e a mensagem do erro, sem credenciais, cortada.
      const { nome, mensagem } = descreverErroSeguro(falha, url);
      erro('worker.job_falhou', { ...base, erro: { nome, mensagem: mensagem.slice(0, LIMITE_MENSAGEM) } });
      throw falha;
    } finally {
      job.signal.removeEventListener('abort', aoAbortar);
      emAndamento--;
    }
  };

  const etapa = async <T>(passo: () => Promise<T>): Promise<T> => {
    if (parado) throw new FalhaDeInicio({ motivo: 'encerrado_durante_inicio' });
    return passo();
  };

  const iniciar = async () => {
    await etapa(() => fila.start());

    // Filas: cria (idempotente), confere a política (imutável, R-2) e aplica o retry do ambiente
    // (o createQueue não atualiza uma fila existente).
    for (const def of definicoes) {
      await etapa(() => fila.createQueue(def.fila, { policy: def.politica, ...retry }));
      const atual = await etapa(() => fila.getQueue(def.fila));
      if (atual?.policy !== def.politica) {
        throw new FalhaDeInicio({
          motivo: 'politica_divergente',
          fila: def.fila,
          esperada: def.politica,
          atual: atual?.policy ?? null,
        });
      }
      await etapa(() => fila.updateQueue(def.fila, retry));
    }

    for (const def of definicoes) {
      const opcoes = {
        includeMetadata: true as const,
        batchSize: 1,
        ...(deps.intervaloBuscaSegundos !== undefined ? { pollingIntervalSeconds: deps.intervaloBuscaSegundos } : {}),
      };
      await etapa(() =>
        fila.work<unknown, void, typeof opcoes>(def.fila, opcoes, async (jobs) => {
          for (const job of jobs) await processarJob(def, job);
        }),
      );
    }

    // Agendamentos (RN-16): upsert dos crons em UTC e remoção dos órfãos.
    const comCron = new Set<string>();
    for (const def of definicoes) {
      if (!def.cron) continue;
      comCron.add(def.fila);
      const cron = def.cron;
      await etapa(() => fila.schedule(def.fila, cron, {}, { tz: 'UTC', ...retry }));
    }
    for (const s of await etapa(() => fila.getSchedules())) {
      if (s.name.startsWith(PREFIXO_INTERNO)) continue;
      if (s.key === '' && comCron.has(s.name)) continue;
      await etapa(() => fila.unschedule(s.name, s.key));
    }

    if (parado) return;
    log('worker.iniciado', { filas: definicoes.map((d) => d.fila).sort() });
    const heartbeat = () => log('worker.heartbeat');
    heartbeat();
    intervalo = setInterval(heartbeat, deps.intervaloMs ?? INTERVALO_HEARTBEAT_MS);
  };

  const pronto = iniciar().catch(async (falha: unknown) => {
    // Um sinal durante o início: o encerramento cuida da saída.
    if (parado) return;
    parado = true;
    const campos =
      falha instanceof FalhaDeInicio ? falha.campos : descreverErroSeguro(falha, url);
    erro('worker.falha_inicio', campos);
    await fila.stop({ graceful: false, close: true }).catch(() => undefined);
    sair(1);
  });

  const encerrar = (origem: Sinal | 'teste' = 'teste'): Promise<number> => {
    if (encerrando) return encerrando;
    encerrando = (async () => {
      if (saiu !== null) return saiu;
      parado = true;
      clearInterval(intervalo);
      log('worker.encerrando', { sinal: origem });
      try {
        // O stop() resolve mesmo com o prazo estourado (falha os jobs ativos e aborta o sinal deles):
        // por isso o worker conta os próprios jobs em andamento (D-9).
        await fila.stop({ graceful: true, timeout: timeoutEncerramento });
      } catch (falha) {
        erro('worker.erro_encerramento', descreverErroSeguro(falha, url));
        sair(1);
        return 1;
      }
      if (emAndamento > 0 || interrompidos > 0) {
        erro('worker.encerramento_forcado', { emAndamento, interrompidos });
        sair(1);
        return 1;
      }
      log('worker.encerrado');
      sair(0);
      return 0;
    })();
    return encerrando;
  };

  // Ligados antes do start(): um sinal durante o início também encerra. Sinais seguintes: ignorados.
  deps.sinais.on('SIGTERM', () => void encerrar('SIGTERM'));
  deps.sinais.on('SIGINT', () => void encerrar('SIGINT'));

  return { pronto, encerrar };
}
