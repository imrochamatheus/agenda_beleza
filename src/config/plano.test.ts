import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { DIAS_TESTE, PRECO_MENSAL_CENTAVOS } from './plano';

describe('src/config/plano.ts (CA-7)', () => {
  it('CA-7: expõe o preço de 7900 centavos e 30 dias de teste', () => {
    expect(PRECO_MENSAL_CENTAVOS).toBe(7900);
    expect(DIAS_TESTE).toBe(30);
  });

  it('CA-7: não importa nada (usável em componente cliente)', () => {
    const fonte = readFileSync(fileURLToPath(new URL('./plano.ts', import.meta.url)), 'utf8');
    expect(fonte).not.toMatch(/^\s*import\s/m);
    expect(fonte).not.toMatch(/\brequire\(/);
  });
});
