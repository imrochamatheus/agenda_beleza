import type { ConstructorOptions, JobWithMetadata } from 'pg-boss';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FILA } from '@/server/queue/filas';

import { definirHandler, type ContextoJob, type DefinicaoFila } from './handlers/tipos';
import { type DependenciasWorker, type FilaWorker, INTERVALO_HEARTBEAT_MS, iniciarWorker, TIMEOUT_ENCERRAMENTO_MS } from './iniciar';

// Unitários da orquestração do worker com um dublê do pg-boss (não é mock de banco: só a ordem das
// chamadas, os sinais e os logs são verificados aqui; o pg-boss real roda em tests/integration/worker).

type Sinal = 'SIGTERM' | 'SIGINT';
type Handler = (jobs: JobWithMetadata<unknown>[]) => Promise<void>;
type Agendamento = { name: string; key: string };

const URL_BANCO = 'postgresql://agenda:senha-do-banco@h:5432/d';

function dubleFila(
  opcoes: {
    start?: () => Promise<unknown>;
    stop?: () => Promise<void>;
    filas?: Record<string, string>;
    agendamentos?: Agendamento[];
  } = {},
) {
  const chamadas: string[] = [];
  const ouvintes = new Map<string, (e: unknown) => void>();
  const filas = new Map(Object.entries(opcoes.filas ?? {}));
  const handlers = new Map<string, Handler>();
  const fila = {
    on: vi.fn((evento: string, fn: (e: unknown) => void) => {
      chamadas.push(`on:${evento}`);
      ouvintes.set(evento, fn);
    }),
    start: vi.fn(async () => {
      chamadas.push('start');
      await opcoes.start?.();
    }),
    stop: vi.fn<(o?: unknown) => Promise<void>>(async () => {
      chamadas.push('stop');
      await opcoes.stop?.();
    }),
    createQueue: vi.fn(async (nome: string, o: { policy: string }) => {
      chamadas.push(`createQueue:${nome}`);
      if (!filas.has(nome)) filas.set(nome, o.policy);
    }),
    getQueue: vi.fn(async (nome: string) => (filas.has(nome) ? { name: nome, policy: filas.get(nome) } : null)),
    updateQueue: vi.fn<(nome: string, o: unknown) => Promise<void>>(async (nome) => {
      chamadas.push(`updateQueue:${nome}`);
    }),
    work: vi.fn<(nome: string, o: unknown, h: Handler) => Promise<string>>(async (nome, _, h) => {
      chamadas.push(`work:${nome}`);
      handlers.set(nome, h);
      return `w-${nome}`;
    }),
    schedule: vi.fn<(nome: string, ...r: unknown[]) => Promise<void>>(async (nome) => {
      chamadas.push(`schedule:${nome}`);
    }),
    getSchedules: vi.fn(async () => {
      chamadas.push('getSchedules');
      return opcoes.agendamentos ?? [];
    }),
    unschedule: vi.fn(async (nome: string, chave: string) => {
      chamadas.push(`unschedule:${nome}:${chave}`);
    }),
  };
  return { fila, chamadas, ouvintes, handlers };
}

function dependencias(
  extra: Partial<Omit<DependenciasWorker, 'log' | 'erro' | 'sinais' | 'sair' | 'criarFila' | 'env'>> = {},
  env: Record<string, string | undefined> = { DATABASE_URL: URL_BANCO },
  duble = dubleFila(),
) {
  const ouvintes = new Map<Sinal, Array<() => void>>();
  const criarFila = vi.fn<(o: ConstructorOptions) => FilaWorker>(() => duble.fila as unknown as FilaWorker);
  const base = {
    env,
    log: vi.fn<(linha: string) => void>(),
    erro: vi.fn<(linha: string) => void>(),
    sinais: {
      on: vi.fn((evento: Sinal, fn: () => void) => ouvintes.set(evento, [...(ouvintes.get(evento) ?? []), fn])),
    },
    sair: vi.fn<(codigo: number) => void>(),
    criarFila,
  } satisfies DependenciasWorker;
  // As opções extras não substituem os espiões acima (mantêm o tipo deles).
  const deps = { ...base, ...extra };
  const sinal = (s: Sinal) => ouvintes.get(s)?.forEach((fn) => fn());
  const eventos = () => deps.log.mock.calls.map(([l]) => JSON.parse(l));
  const erros = () => deps.erro.mock.calls.map(([l]) => JSON.parse(l));
  return { deps, sinal, eventos, erros, criarFila, ...duble };
}

function job(id: string, data: unknown, retryCount = 0, signal = new AbortController().signal): JobWithMetadata<unknown> {
  return { id, data, retryCount, signal, startAfter: new Date('2026-11-18T12:00:00Z') } as JobWithMetadata<unknown>;
}

/** Deixa as promessas pendentes andarem (o relógio falso não afeta microtarefas). */
const fluir = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

const ADAPTADORES_SIMULADOS = {
  evento: 'worker.adaptadores',
  em: '2026-11-18T12:00:00.000Z',
  armazenamento: 'simulado',
  email: 'simulado',
  mercadoPago: 'simulado',
  turnstile: 'simulado',
  whatsapp: 'simulado',
};

describe('iniciarWorker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-18T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('início (CA-13, RN-14)', () => {
    it('registra adaptadores → iniciado → heartbeat a cada 30 s, com `em` em UTC', async () => {
      const { deps, eventos } = dependencias();
      await iniciarWorker(deps).pronto;
      expect(eventos()).toEqual([
        ADAPTADORES_SIMULADOS,
        {
          evento: 'worker.iniciado',
          em: '2026-11-18T12:00:00.000Z',
          filas: ['assinatura-prazos', 'exemplo', 'reconciliar-mensagens', 'whatsapp-reserva'],
        },
        { evento: 'worker.heartbeat', em: '2026-11-18T12:00:00.000Z' },
      ]);
      vi.advanceTimersByTime(INTERVALO_HEARTBEAT_MS - 1);
      expect(eventos()).toHaveLength(3);
      vi.advanceTimersByTime(1);
      expect(eventos()[3]).toEqual({ evento: 'worker.heartbeat', em: '2026-11-18T12:00:30.000Z' });
      vi.advanceTimersByTime(INTERVALO_HEARTBEAT_MS);
      expect(eventos()).toHaveLength(5);
      expect(deps.sair).not.toHaveBeenCalled();
    });

    it('respeita o intervaloMs injetado', async () => {
      const { deps, eventos } = dependencias({ intervaloMs: 10 });
      await iniciarWorker(deps).pronto;
      vi.advanceTimersByTime(30);
      // adaptadores + iniciado + heartbeat inicial + 3 heartbeats.
      expect(eventos()).toHaveLength(6);
    });

    it('usa as opções do papel worker, liga error/warning antes do start, sincroniza filas, consumidores e crons', async () => {
      const { deps, chamadas, criarFila, fila } = dependencias(
        { intervaloBuscaSegundos: 0.5 },
        { DATABASE_URL: URL_BANCO, QUEUE_RETRY_LIMIT: '2', QUEUE_RETRY_DELAY_SECONDS: '5', QUEUE_RETRY_BACKOFF: 'false' },
      );
      await iniciarWorker(deps).pronto;
      expect(criarFila).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ connectionString: URL_BANCO, schema: 'pgboss', migrate: true, schedule: true, max: 4 }),
      );
      expect(chamadas).toEqual([
        'on:error',
        'on:warning',
        'start',
        'createQueue:exemplo',
        'updateQueue:exemplo',
        'createQueue:assinatura-prazos',
        'updateQueue:assinatura-prazos',
        'createQueue:whatsapp-reserva',
        'updateQueue:whatsapp-reserva',
        'createQueue:reconciliar-mensagens',
        'updateQueue:reconciliar-mensagens',
        'work:exemplo',
        'work:assinatura-prazos',
        'work:whatsapp-reserva',
        'work:reconciliar-mensagens',
        'schedule:assinatura-prazos',
        'schedule:reconciliar-mensagens',
        'getSchedules',
      ]);
      const retry = { retryLimit: 2, retryDelay: 5, retryBackoff: false };
      expect(fila.createQueue).toHaveBeenCalledWith('whatsapp-reserva', { policy: 'exclusive', ...retry });
      expect(fila.createQueue).toHaveBeenCalledWith('exemplo', { policy: 'standard', ...retry });
      expect(fila.updateQueue).toHaveBeenCalledWith('exemplo', retry);
      expect(fila.work).toHaveBeenCalledWith(
        'exemplo',
        { includeMetadata: true, batchSize: 1, pollingIntervalSeconds: 0.5 },
        expect.any(Function),
      );
      expect(fila.schedule).toHaveBeenCalledWith('assinatura-prazos', '*/5 * * * *', {}, { tz: 'UTC', ...retry });
      expect(fila.schedule).toHaveBeenCalledWith('reconciliar-mensagens', '* * * * *', {}, { tz: 'UTC', ...retry });
    });

    it('sem intervaloBuscaSegundos usa o padrão da biblioteca (não passa a opção)', async () => {
      const { deps, fila } = dependencias();
      await iniciarWorker(deps).pronto;
      expect(fila.work.mock.calls[0][1]).toEqual({ includeMetadata: true, batchSize: 1 });
    });

    it('RN-16: remove agendamentos órfãos e de outra chave; mantém os do registro e os internos do pg-boss', async () => {
      const duble = dubleFila({
        agendamentos: [
          { name: 'assinatura-prazos', key: '' },
          { name: 'reconciliar-mensagens', key: '' },
          { name: 'fila-antiga', key: '' },
          { name: 'assinatura-prazos', key: 'k2' },
          { name: '__pgboss__send-it', key: '' },
        ],
      });
      const { deps, chamadas } = dependencias({}, undefined, duble);
      await iniciarWorker(deps).pronto;
      expect(chamadas.filter((c) => c.startsWith('unschedule'))).toEqual([
        'unschedule:fila-antiga:',
        'unschedule:assinatura-prazos:k2',
      ]);
    });

    it('R-2: política divergente numa fila existente → falha_inicio, stop sem graça e saída 1', async () => {
      const duble = dubleFila({ filas: { 'whatsapp-reserva': 'standard' } });
      const { deps, erros, eventos, fila } = dependencias({}, undefined, duble);
      await iniciarWorker(deps).pronto;
      expect(erros()).toEqual([
        {
          evento: 'worker.falha_inicio',
          em: '2026-11-18T12:00:00.000Z',
          motivo: 'politica_divergente',
          fila: 'whatsapp-reserva',
          esperada: 'exclusive',
          atual: 'standard',
        },
      ]);
      expect(fila.stop).toHaveBeenCalledExactlyOnceWith({ graceful: false, close: true });
      expect(fila.work).not.toHaveBeenCalled();
      expect(deps.sair).toHaveBeenCalledExactlyOnceWith(1);
      expect(eventos().map((e) => e.evento)).toEqual(['worker.adaptadores']);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('fila ausente depois do createQueue conta como divergente (atual: null)', async () => {
      const duble = dubleFila();
      duble.fila.getQueue.mockResolvedValue(null);
      const { deps, erros } = dependencias({}, undefined, duble);
      await iniciarWorker(deps).pronto;
      expect(erros()[0]).toMatchObject({ motivo: 'politica_divergente', atual: null });
    });

    it('falha no start → falha_inicio sem a senha, saída 1; stop que também falha não propaga', async () => {
      const duble = dubleFila({
        start: async () => {
          throw Object.assign(new Error(`não conectou em ${URL_BANCO}`), { code: '3D000' });
        },
        stop: async () => {
          throw new Error('stop falhou');
        },
      });
      const { deps, erros } = dependencias({}, undefined, duble);
      const controle = iniciarWorker(deps);
      await controle.pronto;
      expect(erros()).toEqual([
        { evento: 'worker.falha_inicio', em: '2026-11-18T12:00:00.000Z', nome: 'Error', codigo: '3D000', mensagem: 'não conectou em ***' },
      ]);
      expect(deps.erro.mock.calls[0][0]).not.toContain('senha-do-banco');
      expect(deps.sair).toHaveBeenCalledExactlyOnceWith(1);
      // Encerrar depois da falha não chama stop de novo nem sai outra vez.
      await expect(controle.encerrar()).resolves.toBe(1);
      expect(deps.sair).toHaveBeenCalledTimes(1);
    });

    it('ouvintes do pg-boss: error vira worker.erro_fila sem senha; warning vira worker.aviso_fila', async () => {
      const { deps, ouvintes, erros, eventos } = dependencias();
      await iniciarWorker(deps).pronto;
      ouvintes.get('error')!(Object.assign(new Error(`terminating connection ${URL_BANCO}`), { code: '57P01' }));
      ouvintes.get('warning')!({ message: 'slow query', data: {} });
      expect(erros().at(-1)).toMatchObject({ evento: 'worker.erro_fila', codigo: '57P01', nome: 'Error' });
      expect(deps.erro.mock.calls.at(-1)![0]).not.toContain('senha-do-banco');
      expect(eventos().at(-1)).toMatchObject({ evento: 'worker.aviso_fila', mensagem: 'slow query' });
      expect(deps.sair).not.toHaveBeenCalled();
    });
  });

  describe('ambiente inválido (CA-11, CA-13; D-007 CA-2 e CA-9)', () => {
    it('nomeia a variável, sai com 1, não cria a fila, não liga sinais nem heartbeat', async () => {
      const { deps, criarFila } = dependencias({}, { DATABASE_URL: 'senha-secreta' });
      const controle = iniciarWorker(deps);
      await controle.pronto;
      expect(deps.sair).toHaveBeenCalledExactlyOnceWith(1);
      expect(deps.log).not.toHaveBeenCalled();
      expect(criarFila).not.toHaveBeenCalled();
      expect(deps.sinais.on).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
      const linha = deps.erro.mock.calls[0][0];
      expect(JSON.parse(linha)).toEqual({
        evento: 'worker.ambiente_invalido',
        em: '2026-11-18T12:00:00.000Z',
        variaveis: ['DATABASE_URL'],
      });
      expect(linha).not.toContain('senha-secreta');
      await expect(controle.encerrar()).resolves.toBe(1);
    });

    it.each([
      ['QUEUE_RETRY_LIMIT', '21'],
      ['QUEUE_RETRY_DELAY_SECONDS', '0'],
      ['QUEUE_RETRY_BACKOFF', 'sim'],
    ])('CA-11: %s=%j → worker.ambiente_invalido e saída 1, sem tocar no banco', async (variavel, valor) => {
      const { deps, criarFila, erros } = dependencias({}, { DATABASE_URL: URL_BANCO, [variavel]: valor });
      await iniciarWorker(deps).pronto;
      expect(deps.sair).toHaveBeenCalledExactlyOnceWith(1);
      expect(criarFila).not.toHaveBeenCalled();
      expect(erros()[0]).toMatchObject({ evento: 'worker.ambiente_invalido', variaveis: [variavel] });
    });

    it('D-007 CA-2: EMAIL_ADAPTER=real sem SMTP_HOST sai com 1 e nomeia SMTP_HOST', async () => {
      const { deps, erros } = dependencias({}, {
        DATABASE_URL: URL_BANCO,
        EMAIL_ADAPTER: 'real',
        EMAIL_FROM: 'nao-responda@exemplo.com',
      });
      await iniciarWorker(deps).pronto;
      expect(deps.sair).toHaveBeenCalledExactlyOnceWith(1);
      expect(deps.log).not.toHaveBeenCalled();
      expect(erros()[0]).toMatchObject({ evento: 'worker.ambiente_invalido', variaveis: ['SMTP_HOST'] });
    });

    it.each(['MP_ADAPTER', 'WHATSAPP_ADAPTER'])('D-007 CA-9: com %s=real sai com 1 nomeando o seletor', async (seletor) => {
      const { deps, erros } = dependencias({}, { DATABASE_URL: URL_BANCO, [seletor]: 'real' });
      await iniciarWorker(deps).pronto;
      expect(deps.sair).toHaveBeenCalledExactlyOnceWith(1);
      expect(erros()[0].variaveis).toEqual([seletor]);
    });
  });

  it('D-007 CA-1: registra os quatro modos antes de tudo, sem nenhum valor de configuração', async () => {
    const { deps } = dependencias({}, {
      DATABASE_URL: URL_BANCO,
      TURNSTILE_ADAPTER: 'real',
      TURNSTILE_SITE_KEY: 'chave-publica-do-site',
      TURNSTILE_SECRET_KEY: 'segredo-do-turnstile',
    });
    await iniciarWorker(deps).pronto;
    const linhas = deps.log.mock.calls.map(([l]) => l);
    const primeiro = JSON.parse(linhas[0]);
    expect(primeiro.em).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(primeiro).toEqual({ ...ADAPTADORES_SIMULADOS, turnstile: 'real' });
    for (const valor of ['senha-do-banco', 'chave-publica-do-site', 'segredo-do-turnstile']) {
      expect(linhas.join('\n')).not.toContain(valor);
    }
  });

  describe('envoltório de cada job (RN-13)', () => {
    it('valida o payload, passa o contexto e registra worker.job_concluido', async () => {
      const contextos: ContextoJob[] = [];
      const definicoes: DefinicaoFila[] = [
        definirHandler(FILA.whatsappReserva, {
          async processar(p, ctx) {
            contextos.push(ctx);
            ctx.log('teste.processado', { mensagemId: p.mensagemId });
          },
        }),
      ];
      const { deps, handlers, eventos } = dependencias({ definicoes });
      await iniciarWorker(deps).pronto;
      const id = '6f1c2b8e-3d4a-4b5c-9d6e-7f8091a2b3c4';
      await handlers.get('whatsapp-reserva')!([job('j1', { mensagemId: id }, 2)]);
      expect(contextos[0]).toMatchObject({ id: 'j1', fila: 'whatsapp-reserva', tentativa: 3 });
      expect(contextos[0].agendadoPara).toEqual(new Date('2026-11-18T12:00:00Z'));
      expect(contextos[0].sinal).toBeInstanceOf(AbortSignal);
      expect(eventos().slice(-2)).toEqual([
        { evento: 'teste.processado', em: '2026-11-18T12:00:00.000Z', mensagemId: id },
        { evento: 'worker.job_concluido', em: '2026-11-18T12:00:00.000Z', fila: 'whatsapp-reserva', id: 'j1', tentativa: 3 },
      ]);
    });

    it('falha do handler: worker.job_falhou sem o payload, mensagem cortada e erro repassado ao pg-boss', async () => {
      const definicoes: DefinicaoFila[] = [
        definirHandler(FILA.exemplo, {
          async processar() {
            throw new TypeError(`falhou ${'x'.repeat(400)} ${URL_BANCO}`);
          },
        }),
      ];
      const { deps, handlers, erros } = dependencias({ definicoes });
      await iniciarWorker(deps).pronto;
      await expect(handlers.get('exemplo')!([job('j2', { esperaMs: 4242 })])).rejects.toThrow(TypeError);
      const falha = erros().at(-1);
      expect(falha).toMatchObject({ evento: 'worker.job_falhou', fila: 'exemplo', id: 'j2', tentativa: 1 });
      expect(falha.erro.nome).toBe('TypeError');
      expect(falha.erro.mensagem.length).toBeLessThanOrEqual(300);
      const linha = deps.erro.mock.calls.at(-1)![0];
      expect(linha).not.toContain('4242');
      expect(linha).not.toContain('senha-do-banco');
    });

    it('payload inválido falha o job sem chamar processar e sem registrar valores', async () => {
      const processar = vi.fn(async () => undefined);
      const definicoes: DefinicaoFila[] = [definirHandler(FILA.whatsappReserva, { processar })];
      const { deps, handlers, erros } = dependencias({ definicoes });
      await iniciarWorker(deps).pronto;
      await expect(
        handlers.get('whatsapp-reserva')!([job('j3', { mensagemId: 'x', telefone: '5511988887777' })]),
      ).rejects.toThrow(/Payload inválido/);
      expect(processar).not.toHaveBeenCalled();
      expect(erros().at(-1).erro.nome).toBe('ErroPayloadInvalido');
      expect(deps.erro.mock.calls.at(-1)![0]).not.toContain('5511988887777');
    });
  });

  describe('encerramento (CA-14, RN-15, D-9)', () => {
    it.each<Sinal>(['SIGTERM', 'SIGINT'])(
      '%s: para o heartbeat, chama stop uma vez com graceful e 25 s, ignora sinais seguintes e sai com 0',
      async (s) => {
        const { deps, sinal, eventos, fila } = dependencias();
        await iniciarWorker(deps).pronto;
        expect(deps.sinais.on).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
        expect(deps.sinais.on).toHaveBeenCalledWith('SIGINT', expect.any(Function));
        sinal(s);
        sinal('SIGTERM');
        sinal('SIGINT');
        await fluir();
        expect(TIMEOUT_ENCERRAMENTO_MS).toBe(25_000);
        expect(fila.stop).toHaveBeenCalledExactlyOnceWith({ graceful: true, timeout: 25_000 });
        expect(deps.sair).toHaveBeenCalledExactlyOnceWith(0);
        expect(eventos().slice(-2)).toEqual([
          { evento: 'worker.encerrando', em: '2026-11-18T12:00:00.000Z', sinal: s },
          { evento: 'worker.encerrado', em: '2026-11-18T12:00:00.000Z' },
        ]);
        const total = eventos().length;
        vi.advanceTimersByTime(INTERVALO_HEARTBEAT_MS * 3);
        expect(eventos()).toHaveLength(total);
        expect(vi.getTimerCount()).toBe(0);
      },
    );

    it('encerrar() devolve o código, é idempotente e usa o timeout injetado', async () => {
      const { deps, fila } = dependencias({ timeoutEncerramentoMs: 2000 });
      const controle = iniciarWorker(deps);
      await controle.pronto;
      const [a, b] = await Promise.all([controle.encerrar(), controle.encerrar('SIGTERM')]);
      expect([a, b]).toEqual([0, 0]);
      expect(fila.stop).toHaveBeenCalledExactlyOnceWith({ graceful: true, timeout: 2000 });
      expect(deps.sair).toHaveBeenCalledExactlyOnceWith(0);
    });

    it('job ainda em andamento quando o stop resolve → worker.encerramento_forcado e saída 1', async () => {
      let liberar!: () => void;
      const definicoes: DefinicaoFila[] = [
        definirHandler(FILA.exemplo, { processar: () => new Promise<void>((ok) => (liberar = ok)) }),
      ];
      const { deps, handlers, erros } = dependencias({ definicoes });
      const controle = iniciarWorker(deps);
      await controle.pronto;
      const execucao = handlers.get('exemplo')!([job('j4', {})]);
      await expect(controle.encerrar('SIGTERM')).resolves.toBe(1);
      expect(erros().at(-1)).toEqual({
        evento: 'worker.encerramento_forcado',
        em: '2026-11-18T12:00:00.000Z',
        emAndamento: 1,
        interrompidos: 0,
      });
      expect(deps.sair).toHaveBeenCalledExactlyOnceWith(1);
      liberar();
      await execucao;
    });

    it('job interrompido pelo sinal antes do stop resolver também conta como forçado', async () => {
      const ac = new AbortController();
      const duble = dubleFila({
        stop: async () => {
          ac.abort();
          await fluir();
        },
      });
      const definicoes: DefinicaoFila[] = [
        definirHandler(FILA.exemplo, {
          processar: (_p, ctx) =>
            new Promise<void>((_ok, falhar) => ctx.sinal.addEventListener('abort', () => falhar(new Error('interrompido')))),
        }),
      ];
      const { deps, handlers, erros } = dependencias({ definicoes }, undefined, duble);
      const controle = iniciarWorker(deps);
      await controle.pronto;
      const execucao = handlers.get('exemplo')!([job('j5', {}, 0, ac.signal)]).catch((e: unknown) => e);
      await expect(controle.encerrar('SIGTERM')).resolves.toBe(1);
      expect(await execucao).toBeInstanceOf(Error);
      expect(erros().at(-1)).toMatchObject({ evento: 'worker.encerramento_forcado', emAndamento: 0, interrompidos: 1 });
    });

    it('sinal abortado depois de o job concluir (conclusão normal) não conta como interrupção', async () => {
      const ac = new AbortController();
      const { deps, handlers } = dependencias({ definicoes: [definirHandler(FILA.exemplo, { processar: async () => {} })] });
      const controle = iniciarWorker(deps);
      await controle.pronto;
      await handlers.get('exemplo')!([job('j6', {}, 0, ac.signal)]);
      ac.abort();
      await expect(controle.encerrar('SIGTERM')).resolves.toBe(0);
    });

    it('stop que lança → worker.erro_encerramento e saída 1', async () => {
      const duble = dubleFila({
        stop: async () => {
          throw new Error(`falhou ${URL_BANCO}`);
        },
      });
      const { deps, erros } = dependencias({}, undefined, duble);
      const controle = iniciarWorker(deps);
      await controle.pronto;
      await expect(controle.encerrar('SIGINT')).resolves.toBe(1);
      expect(erros().at(-1)).toMatchObject({ evento: 'worker.erro_encerramento', mensagem: 'falhou ***' });
      expect(deps.sair).toHaveBeenCalledExactlyOnceWith(1);
    });

    it('sinal durante o início: não registra iniciado nem falha_inicio, encerra uma vez com 0', async () => {
      let liberarStart!: () => void;
      const duble = dubleFila({ start: () => new Promise<void>((ok) => (liberarStart = ok)) });
      // O stop real do pg-boss espera o start() em andamento.
      duble.fila.stop.mockImplementation(async () => {
        liberarStart();
        await fluir();
      });
      const { deps, sinal, eventos, erros, fila } = dependencias({}, undefined, duble);
      const controle = iniciarWorker(deps);
      sinal('SIGTERM');
      await controle.pronto;
      await fluir();
      expect(fila.createQueue).not.toHaveBeenCalled();
      expect(eventos().map((e) => e.evento)).toEqual(['worker.adaptadores', 'worker.encerrando', 'worker.encerrado']);
      expect(erros()).toEqual([]);
      expect(deps.sair).toHaveBeenCalledExactlyOnceWith(0);
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});
