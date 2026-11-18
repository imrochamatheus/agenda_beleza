import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Ponto de entrada: o import executa o check-env sobre process.env e define process.exitCode.
describe('src/scripts/check-env.ts', () => {
  let codigoOriginal: typeof process.exitCode;

  beforeEach(() => {
    codigoOriginal = process.exitCode;
    vi.resetModules();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.exitCode = codigoOriginal;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('define exitCode 0 com o ambiente válido', async () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://a:b@h:5432/d');
    vi.stubEnv('APP_URL', '');
    await import('./check-env');
    expect(process.exitCode).toBe(0);
    expect(console.log).toHaveBeenCalledWith('check-env: ambiente válido');
  });

  it('define exitCode 1 e nomeia DATABASE_URL quando ela falta', async () => {
    vi.stubEnv('DATABASE_URL', '');
    await import('./check-env');
    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('DATABASE_URL'));
  });
});
