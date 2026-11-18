import { existsSync } from 'node:fs';
import { isAbsolute } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { binarioPrisma, executarPrisma, prepararBancoDeTeste } from './db';

// Porta 1 em localhost: nada escuta ali. Se o harness abrisse uma conexão antes da guarda,
// o erro seria ECONNREFUSED, e não a mensagem de urlBancoDeTeste() (R-3 do desenho).
const PORTA_FECHADA_DEV = 'postgresql://agenda:x@localhost:1/agenda_beleza';
const PORTA_FECHADA_TESTE = 'postgresql://agenda:x@localhost:1/agenda_beleza_test';

describe('prepararBancoDeTeste: guarda antes de qualquer comando destrutivo (CA-21)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('CA-21: TEST_DATABASE_URL ausente falha com a mensagem da guarda, sem tentar conectar', async () => {
    vi.stubEnv('DATABASE_URL', PORTA_FECHADA_DEV);
    vi.stubEnv('TEST_DATABASE_URL', '');
    await expect(prepararBancoDeTeste()).rejects.toThrow(/^TEST_DATABASE_URL não definida/);
  });

  it('CA-21: TEST_DATABASE_URL com a mesma base de DATABASE_URL falha com a mensagem da guarda, sem tentar conectar', async () => {
    vi.stubEnv('DATABASE_URL', PORTA_FECHADA_DEV);
    vi.stubEnv('TEST_DATABASE_URL', 'postgresql://outro:y@127.0.0.1:1/agenda_beleza?schema=public');
    await expect(prepararBancoDeTeste()).rejects.toThrow(
      /^TEST_DATABASE_URL aponta para a mesma base de DATABASE_URL/,
    );
  });

  it('controle: passada a guarda, o harness conecta na URL de teste (a porta fechada dá ECONNREFUSED)', async () => {
    vi.stubEnv('DATABASE_URL', PORTA_FECHADA_DEV);
    vi.stubEnv('TEST_DATABASE_URL', PORTA_FECHADA_TESTE);
    await expect(prepararBancoDeTeste()).rejects.toMatchObject({ code: 'ECONNREFUSED' });
  });
});

describe('executarPrisma', () => {
  it('resolve o binário do Prisma por caminho absoluto existente', () => {
    const bin = binarioPrisma();
    expect(isAbsolute(bin)).toBe(true);
    expect(existsSync(bin)).toBe(true);
  });

  it('sobrescreve DATABASE_URL do ambiente e do .env pela URL recebida', () => {
    // O .env aponta DATABASE_URL para localhost:5432/agenda_beleza; o filho precisa usar a URL passada.
    const r = executarPrisma(['migrate', 'status'], PORTA_FECHADA_TESTE);
    expect(r.status).not.toBe(0);
    expect(r.stdout).toContain('database "agenda_beleza_test"');
    expect(r.stdout).toContain('at "localhost:1"');
    expect(r.stderr).toContain('P1001');
  });
});
