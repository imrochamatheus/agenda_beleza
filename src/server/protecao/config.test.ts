import { describe, expect, it } from 'vitest';

import { ErroDeAmbiente } from '@/server/env';

import { SEGREDO_DE_DESENVOLVIMENTO, configDaProtecao, segredoDoLimite } from './config';

describe('configDaProtecao', () => {
  it('padrões documentados', () => {
    expect(configDaProtecao({})).toEqual({
      proxyHops: 0,
      janelaSegundos: 900,
      limiteIp: { reserva: 10, disponibilidade: 60, avaliacao: 5, denuncia: 5 },
      limiteNumero: 5,
    });
  });

  it('lê as variáveis; vazio vale o padrão', () => {
    const c = configDaProtecao({ TRUSTED_PROXY_HOPS: '2', PROTECAO_LIMITE_IP_DENUNCIA: '7', PROTECAO_JANELA_SEGUNDOS: '' });
    expect(c.proxyHops).toBe(2);
    expect(c.limiteIp.denuncia).toBe(7);
    expect(c.janelaSegundos).toBe(900);
  });

  it('valor inválido lança nomeando a variável', () => {
    for (const v of ['-1', '11', 'abc', '1.5', ' 1']) {
      const e = (() => {
        try {
          configDaProtecao({ TRUSTED_PROXY_HOPS: v });
        } catch (x) {
          return x as ErroDeAmbiente;
        }
        throw new Error('deveria falhar');
      })();
      expect(e).toBeInstanceOf(ErroDeAmbiente);
      expect(e.variaveis).toEqual(['TRUSTED_PROXY_HOPS']);
    }
  });
});

describe('segredoDoLimite', () => {
  it('usa o configurado', () => {
    expect(segredoDoLimite({ RATE_LIMIT_SEGREDO: 'x'.repeat(40) })).toBe('x'.repeat(40));
  });
  it('fora de produção cai no padrão fixo; em produção exige', () => {
    expect(segredoDoLimite({})).toBe(SEGREDO_DE_DESENVOLVIMENTO);
    expect(SEGREDO_DE_DESENVOLVIMENTO.length).toBeGreaterThanOrEqual(32);
    expect(() => segredoDoLimite({ NODE_ENV: 'production' })).toThrow(/RATE_LIMIT_SEGREDO/);
  });
  it('segredo curto é recusado', () => {
    expect(() => segredoDoLimite({ RATE_LIMIT_SEGREDO: 'curto' })).toThrow(/32/);
  });
});
