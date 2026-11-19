import { describe, expect, it } from 'vitest';

import { TAMANHO_MAXIMO_TOKEN, tokenTurnstileAceitavel } from './port';

describe('turnstile/port', () => {
  it('limita o token a 2048 caracteres (limite documentado pela Cloudflare)', () => {
    expect(TAMANHO_MAXIMO_TOKEN).toBe(2048);
  });

  it.each([
    ['ausente (undefined)', undefined],
    ['nulo', null],
    ['vazio', ''],
    ['só com espaços', '  \t '],
    ['maior que 2048', 'a'.repeat(TAMANHO_MAXIMO_TOKEN + 1)],
  ])('token %s não é aceitável (vira token_invalido sem rede)', (_caso, token) => {
    expect(tokenTurnstileAceitavel(token)).toBe(false);
  });

  it.each([
    ['curto', 'XXXX.DUMMY.TOKEN.XXXX'],
    ['com exatamente 2048', 'a'.repeat(TAMANHO_MAXIMO_TOKEN)],
  ])('token %s é aceitável para envio', (_caso, token) => {
    expect(tokenTurnstileAceitavel(token)).toBe(true);
  });
});
