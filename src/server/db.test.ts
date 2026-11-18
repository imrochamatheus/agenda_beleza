import { afterEach, describe, expect, it, vi } from 'vitest';

import { criarPrisma, encerrarPrisma, obterPrisma } from './db';

// Nenhum teste aqui abre conexão: o cliente só conecta na primeira consulta.
const URL_A = 'postgresql://x:y@127.0.0.1:1/a';
const URL_B = 'postgresql://x:y@127.0.0.1:1/b';

describe('db', () => {
  afterEach(async () => {
    vi.unstubAllEnvs();
    await encerrarPrisma();
  });

  it('criarPrisma devolve um PrismaClient novo a cada chamada', () => {
    const cliente = criarPrisma(URL_A);
    // O construtor do Prisma 7 devolve um proxy (instanceof PrismaClient é false, e os matchers
    // estouram a pilha ao formatá-lo); por isso o teste confere o contrato e usa comparações booleanas.
    expect(typeof cliente.$queryRaw).toBe('function');
    expect(typeof cliente.$disconnect).toBe('function');
    expect(criarPrisma(URL_A) === cliente).toBe(false);
  });

  it('obterPrisma reaproveita o cliente da mesma URL e separa URLs diferentes', () => {
    const a = obterPrisma(URL_A);
    expect(obterPrisma(URL_A)).toBe(a);
    expect(obterPrisma(URL_B)).not.toBe(a);
  });

  it('lê DATABASE_URL na chamada, não no import', () => {
    vi.stubEnv('DATABASE_URL', URL_B);
    expect(obterPrisma()).toBe(obterPrisma(URL_B));
  });

  it('lança sem DATABASE_URL, nomeando a variável', () => {
    vi.stubEnv('DATABASE_URL', '');
    expect(() => obterPrisma()).toThrow('DATABASE_URL não definida');
  });

  it('encerrarPrisma desconecta e esvazia o cache', async () => {
    const a = obterPrisma(URL_A);
    const desconectar = vi.spyOn(a, '$disconnect');
    await encerrarPrisma();
    expect(desconectar).toHaveBeenCalledTimes(1);
    expect(obterPrisma(URL_A)).not.toBe(a);
  });
});
