import { afterEach, describe, expect, it, vi } from 'vitest';

import { nomeDaBase, urlBancoDeTeste } from './banco';

// Testes puros (sem acesso ao banco) da guarda de RN-9, S-5 e do ajuste A-3 do DBA.
const DEV = 'postgresql://agenda:agenda_dev@localhost:5432/agenda_beleza';
const TESTE = 'postgresql://agenda:agenda_dev@localhost:5432/agenda_beleza_test';

describe('nomeDaBase', () => {
  it('extrai o nome sem a barra, sem query e sem fragmento', () => {
    expect(nomeDaBase(DEV)).toBe('agenda_beleza');
    expect(nomeDaBase(`${DEV}?schema=public&sslmode=disable`)).toBe('agenda_beleza');
    expect(nomeDaBase(`${DEV}#x`)).toBe('agenda_beleza');
  });

  it('decodifica o nome', () => {
    expect(nomeDaBase('postgresql://a:b@h:5432/base%5Fx')).toBe('base_x');
  });
});

describe('urlBancoDeTeste', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('devolve TEST_DATABASE_URL quando a base é diferente da de desenvolvimento', () => {
    vi.stubEnv('DATABASE_URL', DEV);
    vi.stubEnv('TEST_DATABASE_URL', TESTE);
    expect(urlBancoDeTeste()).toBe(TESTE);
  });

  it('aceita TEST_DATABASE_URL sem DATABASE_URL definida', () => {
    vi.stubEnv('DATABASE_URL', '');
    vi.stubEnv('TEST_DATABASE_URL', TESTE);
    expect(urlBancoDeTeste()).toBe(TESTE);
  });

  it('falha nomeando TEST_DATABASE_URL quando ela falta (S-5)', () => {
    vi.stubEnv('TEST_DATABASE_URL', '');
    expect(() => urlBancoDeTeste()).toThrow(/TEST_DATABASE_URL não definida/);
  });

  it.each([
    ['a mesma URL', DEV],
    ['127.0.0.1 no lugar de localhost', 'postgresql://agenda:agenda_dev@127.0.0.1:5432/agenda_beleza'],
    ['?schema=public a mais', `${DEV}?schema=public`],
    ['outro usuário, host e porta', 'postgres://outro:x@postgres:5433/agenda_beleza'],
  ])('recusa a mesma base de DATABASE_URL: %s (RN-9, A-3)', (_caso, urlTeste) => {
    vi.stubEnv('DATABASE_URL', DEV);
    vi.stubEnv('TEST_DATABASE_URL', urlTeste);
    expect(() => urlBancoDeTeste()).toThrow(/mesma base de DATABASE_URL/);
  });
});
