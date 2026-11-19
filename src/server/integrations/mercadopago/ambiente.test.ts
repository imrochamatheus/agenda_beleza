import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { CHAVES, lerConfigReal, SELETOR } from './ambiente';

describe('mercadopago/ambiente (D-1)', () => {
  it('declara o seletor MP_ADAPTER e nenhuma variável de provedor até a E6.6', () => {
    expect(SELETOR).toBe('MP_ADAPTER');
    expect(CHAVES).toEqual([]);
  });

  it('não importa nada (entra no bundle do check-env)', () => {
    const fonte = readFileSync(fileURLToPath(new URL('./ambiente.ts', import.meta.url)), 'utf8');
    expect(fonte).not.toMatch(/^import /m);
  });

  it('CA-9: o modo real é recusado nomeando o seletor', () => {
    expect(lerConfigReal()).toEqual({ ok: false, variaveis: ['MP_ADAPTER'] });
  });
});
