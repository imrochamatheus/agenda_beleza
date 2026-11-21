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
    for (const seletor of ['EMAIL_ADAPTER', 'WHATSAPP_ADAPTER', 'MP_ADAPTER', 'TURNSTILE_ADAPTER']) {
      vi.stubEnv(seletor, '');
    }
    await import('./check-env');
    expect(process.exitCode).toBe(0);
    expect(console.log).toHaveBeenCalledWith(
      'check-env: ambiente válido (adaptadores: armazenamento=simulado, email=simulado, mp=simulado, turnstile=simulado, whatsapp=simulado)',
    );
  });

  it('define exitCode 1 e nomeia DATABASE_URL quando ela falta', async () => {
    vi.stubEnv('DATABASE_URL', '');
    await import('./check-env');
    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('DATABASE_URL'));
  });

  it('CA-2: define exitCode 1 e nomeia SMTP_HOST com EMAIL_ADAPTER=real sem SMTP_HOST', async () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://a:b@h:5432/d');
    vi.stubEnv('EMAIL_ADAPTER', 'real');
    vi.stubEnv('SMTP_HOST', '');
    vi.stubEnv('EMAIL_FROM', 'nao-responda@exemplo.com');
    vi.stubEnv('SMTP_USER', '');
    vi.stubEnv('SMTP_PASSWORD', '');
    vi.stubEnv('SMTP_PORT', '');
    vi.stubEnv('SMTP_SECURE', '');
    await import('./check-env');
    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledWith(
      'check-env: Variáveis de ambiente ausentes ou inválidas: SMTP_HOST',
    );
    expect(console.log).not.toHaveBeenCalled();
  });
});
