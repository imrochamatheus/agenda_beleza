import type { PgBoss } from 'pg-boss';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ErroDeAmbiente } from '@/server/env';

import { type CriarPgBoss, criarClienteFila } from './client';
import { ErroFilaIndisponivel, ErroPayloadInvalido } from './erros';

// Unitários sem I/O (CA-10, CA-15, R-11). O pg-boss é substituído por um dublê SÓ aqui, onde nenhum
// acesso ao banco acontece; o comportamento contra o PostgreSQL real fica em tests/integration/fila.

const URL_BANCO = 'postgresql://agenda:senha-do-banco@localhost:5432/agenda';
const UUID = '6f1c2b8e-3d4a-4b5c-9d6e-7f8091a2b3c4';

type Chamada = string;

function dubleBoss(opcoes: { start?: () => Promise<unknown>; send?: () => Promise<string | null> } = {}) {
  const chamadas: Chamada[] = [];
  const ouvintes = new Map<string, (e: unknown) => void>();
  const boss = {
    on: vi.fn((evento: string, fn: (e: unknown) => void) => {
      chamadas.push(`on:${evento}`);
      ouvintes.set(evento, fn);
      return boss;
    }),
    start: vi.fn(async () => {
      chamadas.push('start');
      await opcoes.start?.();
      return boss;
    }),
    send: vi.fn(async () => {
      chamadas.push('send');
      return opcoes.send ? opcoes.send() : 'id-1';
    }),
    stop: vi.fn(async () => {
      chamadas.push('stop');
    }),
  };
  const criar = vi.fn<CriarPgBoss>(() => boss as unknown as PgBoss);
  return { boss, criar, chamadas, ouvintes };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.doUnmock('pg-boss');
  vi.resetModules();
});

describe('CA-15: sem conexão nem leitura de ambiente no import', () => {
  it('importar o módulo não constrói o pg-boss, não lê o ambiente e não registra nada', async () => {
    vi.resetModules();
    const construtor = vi.fn();
    vi.doMock('pg-boss', () => ({ PgBoss: construtor }));
    const erro = vi.spyOn(console, 'error');
    const log = vi.spyOn(console, 'log');
    const modulo = await import('./client');
    expect(typeof modulo.enfileirar).toBe('function');
    expect(construtor).not.toHaveBeenCalled();
    expect(erro).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it('criarClienteFila não lê a fonte nem constrói o pg-boss antes do 1º enfileirar', () => {
    const lidas: string[] = [];
    const fonte = new Proxy({} as Record<string, string | undefined>, {
      get: (_alvo, chave) => {
        lidas.push(String(chave));
        return undefined;
      },
    });
    const { criar } = dubleBoss();
    const cliente = criarClienteFila(fonte, criar);
    expect(lidas).toEqual([]);
    expect(criar).not.toHaveBeenCalled();
    expect(typeof cliente.encerrar).toBe('function');
  });
});

describe('enfileirar (sem I/O real)', () => {
  it('CA-10: payload inválido lança antes de ler o ambiente ou construir o pg-boss', async () => {
    const { criar } = dubleBoss();
    const cliente = criarClienteFila({}, criar);
    await expect(
      cliente.enfileirar('whatsapp-reserva', { mensagemId: UUID, telefone: '1' } as never, { chave: 'k' }),
    ).rejects.toMatchObject({ name: 'ErroPayloadInvalido', campos: ['telefone'] });
    expect(criar).not.toHaveBeenCalled();
  });

  it('chave obrigatória ausente é recusada com (chave), sem I/O', async () => {
    const { criar } = dubleBoss();
    const cliente = criarClienteFila({}, criar);
    const falha = cliente.enfileirar('whatsapp-reserva', { mensagemId: UUID });
    await expect(falha).rejects.toBeInstanceOf(ErroPayloadInvalido);
    await expect(falha).rejects.toMatchObject({ campos: ['(chave)'] });
    expect(criar).not.toHaveBeenCalled();
  });

  it('ErroDeAmbiente sobe sem embrulho no 1º uso', async () => {
    const { criar } = dubleBoss();
    const cliente = criarClienteFila({ QUEUE_RETRY_LIMIT: '99' }, criar);
    const falha = cliente.enfileirar('exemplo', {});
    await expect(falha).rejects.toBeInstanceOf(ErroDeAmbiente);
    await expect(falha).rejects.toMatchObject({ variaveis: ['DATABASE_URL', 'QUEUE_RETRY_LIMIT'] });
    expect(criar).not.toHaveBeenCalled();
  });

  it('R-11: liga o ouvinte de error antes do start; usa as opções do papel app e a política do ambiente', async () => {
    const { boss, criar, chamadas } = dubleBoss();
    const cliente = criarClienteFila(
      { DATABASE_URL: URL_BANCO, QUEUE_RETRY_LIMIT: '3', QUEUE_RETRY_DELAY_SECONDS: '7', QUEUE_RETRY_BACKOFF: 'false' },
      criar,
    );
    await expect(cliente.enfileirar('exemplo', { esperaMs: 10 })).resolves.toEqual({ criado: true, id: 'id-1' });
    await cliente.enfileirar('exemplo', {}, { chave: 'k' });
    expect(chamadas).toEqual(['on:error', 'start', 'send', 'send']);
    expect(criar).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ connectionString: URL_BANCO, migrate: false, supervise: false, schedule: false, max: 2 }),
    );
    expect(boss.send).toHaveBeenNthCalledWith(1, 'exemplo', { esperaMs: 10 }, {
      retryLimit: 3,
      retryDelay: 7,
      retryBackoff: false,
      singletonKey: undefined,
    });
    expect(boss.send).toHaveBeenNthCalledWith(2, 'exemplo', {}, expect.objectContaining({ singletonKey: 'k' }));
  });

  it('o ouvinte de error registra fila.erro sem a senha e não lança', async () => {
    const { criar, ouvintes } = dubleBoss();
    const saida = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const cliente = criarClienteFila({ DATABASE_URL: URL_BANCO }, criar);
    await cliente.enfileirar('exemplo', {});
    ouvintes.get('error')!(Object.assign(new Error(`falhou em ${URL_BANCO}`), { code: '57P01' }));
    const linha = saida.mock.calls[0][0] as string;
    expect(JSON.parse(linha)).toMatchObject({ evento: 'fila.erro', codigo: '57P01', nome: 'Error' });
    expect(JSON.parse(linha).em).toMatch(/Z$/);
    expect(linha).not.toContain('senha-do-banco');
  });

  it('send devolvendo null vira chave_em_uso', async () => {
    const { criar } = dubleBoss({ send: async () => null });
    const cliente = criarClienteFila({ DATABASE_URL: URL_BANCO }, criar);
    await expect(cliente.enfileirar('whatsapp-reserva', { mensagemId: UUID }, { chave: 'k' })).resolves.toEqual({
      criado: false,
      motivo: 'chave_em_uso',
    });
  });

  it('falha no start vira ErroFilaIndisponivel, fecha o pool e a próxima chamada tenta de novo', async () => {
    let falhar = true;
    const { boss, criar } = dubleBoss({
      start: async () => {
        if (falhar) throw new Error('pg-boss is not installed');
      },
    });
    const cliente = criarClienteFila({ DATABASE_URL: URL_BANCO }, criar);
    await expect(cliente.enfileirar('exemplo', {})).rejects.toMatchObject({
      name: 'ErroFilaIndisponivel',
      motivo: 'schema_ausente',
    });
    expect(boss.stop).toHaveBeenCalledWith({ graceful: false, close: true });
    falhar = false;
    await expect(cliente.enfileirar('exemplo', {})).resolves.toEqual({ criado: true, id: 'id-1' });
    expect(criar).toHaveBeenCalledTimes(2);
  });

  it('falha no send vira ErroFilaIndisponivel com o motivo', async () => {
    const { criar } = dubleBoss({
      send: async () => {
        throw Object.assign(new Error('Queue exemplo does not exist'), { code: 'PGBOSS_QUEUE_NOT_FOUND' });
      },
    });
    const cliente = criarClienteFila({ DATABASE_URL: URL_BANCO }, criar);
    const falha = cliente.enfileirar('exemplo', {});
    await expect(falha).rejects.toBeInstanceOf(ErroFilaIndisponivel);
    await expect(falha).rejects.toMatchObject({ motivo: 'fila_inexistente', codigo: 'PGBOSS_QUEUE_NOT_FOUND' });
  });

  it('encerrar é idempotente, fecha o pool uma vez e funciona sem uso prévio ou com start falho', async () => {
    const { boss, criar } = dubleBoss();
    const cliente = criarClienteFila({ DATABASE_URL: URL_BANCO }, criar);
    await cliente.encerrar();
    await cliente.enfileirar('exemplo', {});
    await cliente.encerrar();
    await cliente.encerrar();
    expect(boss.stop).toHaveBeenCalledTimes(1);

    const falho = dubleBoss({ start: async () => Promise.reject(new Error('x')) });
    const outro = criarClienteFila({ DATABASE_URL: URL_BANCO }, falho.criar);
    const pendente = outro.enfileirar('exemplo', {}).catch((e: unknown) => e);
    await outro.encerrar();
    expect(await pendente).toBeInstanceOf(ErroFilaIndisponivel);
  });
});

describe('instância padrão do processo', () => {
  it('enfileirar usa process.env no 1º uso e encerrarFila é idempotente', async () => {
    vi.resetModules();
    const instancia = dubleBoss();
    vi.doMock('pg-boss', () => ({ PgBoss: vi.fn(function () { return instancia.boss; }) }));
    vi.stubEnv('DATABASE_URL', URL_BANCO);
    try {
      const modulo = await import('./client');
      await expect(modulo.enfileirar('exemplo', {})).resolves.toEqual({ criado: true, id: 'id-1' });
      await modulo.enfileirar('exemplo', {});
      expect(instancia.boss.start).toHaveBeenCalledTimes(1);
      await modulo.encerrarFila();
      await modulo.encerrarFila();
      expect(instancia.boss.stop).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
