import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { CHAVES, lerConfigReal, SELETOR } from './ambiente';

describe('turnstile/ambiente (RN-13)', () => {
  it('declara o seletor e as duas chaves da RN-8', () => {
    expect(SELETOR).toBe('TURNSTILE_ADAPTER');
    expect(CHAVES).toEqual(['TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY']);
  });

  it('não importa nada (entra no bundle do check-env)', () => {
    const fonte = readFileSync(fileURLToPath(new URL('./ambiente.ts', import.meta.url)), 'utf8');
    expect(fonte).not.toMatch(/^import /m);
  });

  it('com as duas chaves devolve só o segredo (a chave do site é lida por chamada, CA-14)', () => {
    expect(
      lerConfigReal({ TURNSTILE_SITE_KEY: 'chave-publica', TURNSTILE_SECRET_KEY: 'segredo' }),
    ).toEqual({ ok: true, config: { segredo: 'segredo' } });
  });

  it.each([
    [{}, ['TURNSTILE_SECRET_KEY', 'TURNSTILE_SITE_KEY']],
    [{ TURNSTILE_SITE_KEY: 'chave-publica' }, ['TURNSTILE_SECRET_KEY']],
    [{ TURNSTILE_SECRET_KEY: 'segredo-xyz' }, ['TURNSTILE_SITE_KEY']],
  ])('CA-8: %j nomeia as chaves ausentes, ordenadas e sem valores', (fonte, esperadas) => {
    const r = lerConfigReal(fonte);
    expect(r).toEqual({ ok: false, variaveis: esperadas });
    expect(JSON.stringify(r)).not.toContain('segredo-xyz');
  });
});
