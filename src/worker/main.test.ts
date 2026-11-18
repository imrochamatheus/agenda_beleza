import { afterEach, describe, expect, it, vi } from 'vitest';

import { iniciarWorker } from './stub';

// Substitui o módulo de lógica (não é mock de banco: o stub não acessa o banco)
// para conferir que o ponto de entrada liga as dependências reais do processo.
vi.mock('./stub', () => ({ iniciarWorker: vi.fn() }));

describe('src/worker/main.ts', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('inicia o worker com process.env, console e os sinais do processo', async () => {
    await import('./main');
    expect(iniciarWorker).toHaveBeenCalledTimes(1);
    const deps = vi.mocked(iniciarWorker).mock.calls[0][0];
    expect(deps.env).toBe(process.env);
    expect(deps.log).toBe(console.log);
    expect(deps.erro).toBe(console.error);
    expect(deps.sinais).toBe(process);

    const sair = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    deps.sair(0);
    expect(sair).toHaveBeenCalledWith(0);
  });
});
