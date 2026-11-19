import { afterEach, describe, expect, it, vi } from 'vitest';

import { TAMANHO_MAXIMO_TOKEN } from './port';
import {
  CHAVE_SITE_TURNSTILE_SIMULADA,
  criarTurnstileSimulado,
  TOKEN_TURNSTILE_SIMULADO,
} from './simulado';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Turnstile simulado (CA-4, D-7)', () => {
  it('expõe o token e a chave de teste documentados pela Cloudflare', () => {
    expect(TOKEN_TURNSTILE_SIMULADO).toBe('XXXX.DUMMY.TOKEN.XXXX');
    expect(CHAVE_SITE_TURNSTILE_SIMULADA).toBe('1x00000000000000000000AA');
  });

  it('CA-4: o token documentado é válido, inclusive quando reapresentado', async () => {
    const porta = criarTurnstileSimulado();
    expect(await porta.validar({ token: TOKEN_TURNSTILE_SIMULADO })).toEqual({ valido: true });
    expect(await porta.validar({ token: TOKEN_TURNSTILE_SIMULADO, ip: '203.0.113.7' })).toEqual({
      valido: true,
    });
  });

  it.each([
    ['outro token', 'token-qualquer'],
    ['o documentado com espaço', ` ${TOKEN_TURNSTILE_SIMULADO}`],
    ['o documentado em minúsculas', TOKEN_TURNSTILE_SIMULADO.toLowerCase()],
    ['vazio', ''],
    ['só espaços', '   '],
    ['nulo', null],
    ['ausente', undefined],
    ['maior que o limite', 'X'.repeat(TAMANHO_MAXIMO_TOKEN + 1)],
  ])('CA-4: %s → token_invalido', async (_caso, token) => {
    expect(await criarTurnstileSimulado().validar({ token })).toEqual({
      valido: false,
      motivo: 'token_invalido',
    });
  });

  it('CA-14: no modo simulado, chaveDoSite devolve a chave documentada', () => {
    vi.stubEnv('TURNSTILE_SITE_KEY', 'chave-real-ignorada');
    try {
      expect(criarTurnstileSimulado().chaveDoSite()).toBe(CHAVE_SITE_TURNSTILE_SIMULADA);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('não acessa a rede', async () => {
    const espiao = vi.spyOn(globalThis, 'fetch');
    await criarTurnstileSimulado().validar({ token: TOKEN_TURNSTILE_SIMULADO });
    await criarTurnstileSimulado().validar({ token: 'outro' });
    expect(espiao).not.toHaveBeenCalled();
  });
});
