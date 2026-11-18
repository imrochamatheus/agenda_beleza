import { describe, expect, it } from 'vitest';

import { executarCheckEnv } from './check-env';

function saidaGravada() {
  const linhas = { log: [] as string[], error: [] as string[] };
  return {
    linhas,
    saida: { log: (m: string) => linhas.log.push(m), error: (m: string) => linhas.error.push(m) },
  };
}

describe('executarCheckEnv (CA-6)', () => {
  it('devolve 0 e informa sucesso com o ambiente válido', () => {
    const { linhas, saida } = saidaGravada();
    expect(executarCheckEnv({ DATABASE_URL: 'postgresql://a:b@h:5432/d' }, saida)).toBe(0);
    expect(linhas.log).toEqual(['check-env: ambiente válido']);
    expect(linhas.error).toEqual([]);
  });

  it('devolve 1 e nomeia a variável inválida sem imprimir o valor', () => {
    const { linhas, saida } = saidaGravada();
    const codigo = executarCheckEnv(
      { DATABASE_URL: 'postgresql://a:b@h:5432/d', APP_URL: 'segredo-nao-url' },
      saida,
    );
    expect(codigo).toBe(1);
    expect(linhas.log).toEqual([]);
    expect(linhas.error).toHaveLength(1);
    expect(linhas.error[0]).toContain('APP_URL');
    expect(linhas.error[0]).not.toContain('segredo-nao-url');
  });
});
