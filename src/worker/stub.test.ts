import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type DependenciasWorker, INTERVALO_HEARTBEAT_MS, iniciarWorker } from './stub';

type Sinal = 'SIGTERM' | 'SIGINT';

function dependencias(env: Record<string, string | undefined> = { DATABASE_URL: 'postgresql://a:b@h/d' }) {
  const ouvintes = new Map<Sinal, () => void>();
  const deps = {
    env,
    log: vi.fn<(linha: string) => void>(),
    erro: vi.fn<(linha: string) => void>(),
    sinais: { once: vi.fn((evento: Sinal, fn: () => void) => ouvintes.set(evento, fn)) },
    sair: vi.fn<(codigo: number) => void>(),
  } satisfies DependenciasWorker;
  const eventos = () => deps.log.mock.calls.map(([linha]) => JSON.parse(linha));
  return { deps, ouvintes, eventos };
}

const ADAPTADORES_SIMULADOS = {
  evento: 'worker.adaptadores',
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

  it('emite um heartbeat JSON em UTC logo ao iniciar e a cada intervalo padrão (S-7)', () => {
    const { deps, eventos } = dependencias();
    iniciarWorker(deps);
    expect(eventos()).toEqual([
      ADAPTADORES_SIMULADOS,
      { evento: 'worker.heartbeat', em: '2026-11-18T12:00:00.000Z' },
    ]);

    vi.advanceTimersByTime(INTERVALO_HEARTBEAT_MS - 1);
    expect(eventos()).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(eventos()).toHaveLength(3);
    expect(eventos()[2]).toEqual({ evento: 'worker.heartbeat', em: '2026-11-18T12:00:30.000Z' });
    expect(deps.sair).not.toHaveBeenCalled();
  });

  it('respeita o intervaloMs injetado', () => {
    const { deps, eventos } = dependencias();
    iniciarWorker({ ...deps, intervaloMs: 10 });
    vi.advanceTimersByTime(30);
    // worker.adaptadores + heartbeat inicial + 3 heartbeats.
    expect(eventos()).toHaveLength(5);
  });

  it.each<Sinal>(['SIGTERM', 'SIGINT'])('em %s limpa o intervalo, registra e sai com 0 (CA-10)', (sinal) => {
    const { deps, ouvintes, eventos } = dependencias();
    iniciarWorker(deps);
    expect(deps.sinais.once).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
    expect(deps.sinais.once).toHaveBeenCalledWith('SIGINT', expect.any(Function));

    ouvintes.get(sinal)!();
    expect(eventos().at(-1)).toEqual({ evento: 'worker.encerrando', sinal });
    expect(deps.sair).toHaveBeenCalledExactlyOnceWith(0);

    const total = eventos().length;
    vi.advanceTimersByTime(INTERVALO_HEARTBEAT_MS * 3);
    expect(eventos()).toHaveLength(total);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignora o segundo sinal depois do primeiro', () => {
    const { deps, ouvintes } = dependencias();
    iniciarWorker(deps);
    ouvintes.get('SIGTERM')!();
    ouvintes.get('SIGINT')!();
    expect(deps.sair).toHaveBeenCalledTimes(1);
  });

  it('parar() interrompe o heartbeat e faz um sinal posterior ser ignorado', () => {
    const { deps, ouvintes, eventos } = dependencias();
    iniciarWorker(deps).parar();
    expect(vi.getTimerCount()).toBe(0);
    ouvintes.get('SIGTERM')!();
    expect(deps.sair).not.toHaveBeenCalled();
    expect(eventos()).toHaveLength(2);
  });

  it('com ambiente inválido nomeia a variável, sai com 1 e não inicia o heartbeat (RN-6)', () => {
    const { deps } = dependencias({ DATABASE_URL: 'senha-secreta' });
    const worker = iniciarWorker(deps);
    expect(deps.sair).toHaveBeenCalledExactlyOnceWith(1);
    expect(deps.log).not.toHaveBeenCalled();
    expect(deps.sinais.once).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    const linha = deps.erro.mock.calls[0][0];
    expect(JSON.parse(linha)).toEqual({ evento: 'worker.ambiente_invalido', variaveis: ['DATABASE_URL'] });
    expect(linha).not.toContain('senha-secreta');
    expect(() => worker.parar()).not.toThrow();
  });

  it('CA-1: registra os quatro modos ao iniciar, antes do primeiro heartbeat, sem nenhum valor', () => {
    const { deps } = dependencias({
      DATABASE_URL: 'postgresql://a:senha-do-banco@h/d',
      TURNSTILE_ADAPTER: 'real',
      TURNSTILE_SITE_KEY: 'chave-publica-do-site',
      TURNSTILE_SECRET_KEY: 'segredo-do-turnstile',
    });
    iniciarWorker(deps);
    const linhas = deps.log.mock.calls.map(([linha]) => linha);
    expect(linhas[0]).toBe(
      '{"evento":"worker.adaptadores","email":"simulado","mercadoPago":"simulado","turnstile":"real","whatsapp":"simulado"}',
    );
    expect(JSON.parse(linhas[1]).evento).toBe('worker.heartbeat');
    for (const valor of ['senha-do-banco', 'chave-publica-do-site', 'segredo-do-turnstile']) {
      expect(linhas.join('\n')).not.toContain(valor);
    }
  });

  it('CA-2: com EMAIL_ADAPTER=real sem SMTP_HOST sai com 1 e nomeia SMTP_HOST', () => {
    const { deps } = dependencias({
      DATABASE_URL: 'postgresql://a:b@h/d',
      EMAIL_ADAPTER: 'real',
      EMAIL_FROM: 'nao-responda@exemplo.com',
    });
    iniciarWorker(deps);
    expect(deps.sair).toHaveBeenCalledExactlyOnceWith(1);
    expect(deps.log).not.toHaveBeenCalled();
    expect(JSON.parse(deps.erro.mock.calls[0][0])).toEqual({
      evento: 'worker.ambiente_invalido',
      variaveis: ['SMTP_HOST'],
    });
  });

  it.each(['MP_ADAPTER', 'WHATSAPP_ADAPTER'])('CA-9: com %s=real sai com 1 nomeando o seletor (D-1)', (seletor) => {
    const { deps } = dependencias({ DATABASE_URL: 'postgresql://a:b@h/d', [seletor]: 'real' });
    iniciarWorker(deps);
    expect(deps.sair).toHaveBeenCalledExactlyOnceWith(1);
    expect(JSON.parse(deps.erro.mock.calls[0][0]).variaveis).toEqual([seletor]);
  });
});
