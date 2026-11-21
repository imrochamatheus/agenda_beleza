import { describe, expect, it } from 'vitest';

import { chaveIp, chaveNumero } from './chaves';

const SEGREDO = 's'.repeat(32);

describe('chaves (CA-9)', () => {
  it('chaveIp: hash do IP por escopo, sem o IP em claro', () => {
    const k = chaveIp('reserva', '203.0.113.7');
    expect(k).toMatch(/^pub:reserva:ip:[0-9a-f]{64}$/);
    expect(k).not.toContain('203.0.113.7');
    expect(chaveIp('avaliacao', '203.0.113.7')).not.toBe(k);
    expect(chaveIp('reserva', '203.0.113.8')).not.toBe(k);
  });

  it('chaveNumero: HMAC com salão e segredo; sem E.164 em claro', () => {
    const k = chaveNumero('salao-a', '+5511987654321', SEGREDO);
    expect(k).toMatch(/^pub:reserva:tel:[0-9a-f]{64}$/);
    expect(k).not.toContain('5511987654321');
    expect(chaveNumero('salao-a', '+5511987654321', SEGREDO)).toBe(k);
    expect(chaveNumero('salao-b', '+5511987654321', SEGREDO)).not.toBe(k);
    expect(chaveNumero('salao-a', '+5511987654321', 't'.repeat(32))).not.toBe(k);
  });

  it('chaveNumero sem segredo usa o do ambiente (padrão de desenvolvimento fora de produção)', () => {
    expect(chaveNumero('s', '+5511987654321')).toMatch(/^pub:reserva:tel:[0-9a-f]{64}$/);
  });
});

describe('hashIpDenuncia (D-035)', () => {
  it('HMAC hexadecimal: não contém o IP, é estável, e depende do IP e do segredo', async () => {
    const { hashIpDenuncia } = await import('./chaves');
    const h = hashIpDenuncia('203.0.113.7', SEGREDO);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain('203.0.113.7');
    expect(hashIpDenuncia('203.0.113.7', SEGREDO)).toBe(h);
    expect(hashIpDenuncia('203.0.113.8', SEGREDO)).not.toBe(h);
    expect(hashIpDenuncia('203.0.113.7', 't'.repeat(32))).not.toBe(h);
    // Distinto do SHA-256 puro de chaveIp (que um IPv4 reverteria por força bruta).
    expect(h).not.toBe(chaveIp('denuncia', '203.0.113.7').split(':').pop());
    expect(hashIpDenuncia('203.0.113.7')).toMatch(/^[0-9a-f]{64}$/);
  });
});
