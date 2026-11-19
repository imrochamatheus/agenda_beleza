import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Ponto de entrada: o import executa o script sobre process.argv/process.env e define process.exitCode.
// Só os caminhos sem banco são exercitados aqui; o enfileiramento real está em
// tests/integration/fila/enfileirar-exemplo.test.ts.
describe('src/scripts/enfileirar-exemplo.ts', () => {
  let codigoOriginal: typeof process.exitCode;
  let argvOriginal: string[];

  beforeEach(() => {
    codigoOriginal = process.exitCode;
    argvOriginal = process.argv;
    vi.resetModules();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.exitCode = codigoOriginal;
    process.argv = argvOriginal;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('lê o argumento de process.argv: inválido → exitCode 1 com a mensagem de uso', async () => {
    process.argv = ['node', 'enfileirar-exemplo.js', 'abc'];
    await import('./enfileirar-exemplo');
    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('uso: enfileirar-exemplo'));
    expect(console.log).not.toHaveBeenCalled();
  });

  it('lê process.env: sem DATABASE_URL → exitCode 1 nomeando a variável', async () => {
    process.argv = ['node', 'enfileirar-exemplo.js', '10'];
    vi.stubEnv('DATABASE_URL', '');
    await import('./enfileirar-exemplo');
    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledWith(
      'enfileirar-exemplo: Variáveis de ambiente ausentes ou inválidas: DATABASE_URL',
    );
  });
});
