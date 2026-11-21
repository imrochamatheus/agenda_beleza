import { describe, expect, it } from 'vitest';

import { extrairIp } from './ip';

const h = (xff: string | null, extra: Record<string, string> = {}) => ({
  get: (n: string) => (n.toLowerCase() === 'x-forwarded-for' ? xff : (extra[n.toLowerCase()] ?? null)),
});

describe('extrairIp (CA-6)', () => {
  it('hops 0 ignora x-forwarded-for e x-real-ip: sem socket, balde desconhecido', () => {
    expect(extrairIp(h('1.2.3.4', { 'x-real-ip': '5.6.7.8' }), 0)).toBe('desconhecido');
    expect(extrairIp(h('1.2.3.4'), 0, null)).toBe('desconhecido');
  });

  it('hops 0 usa só o IP da conexão quando houver', () => {
    expect(extrairIp(h('1.2.3.4'), 0, '10.0.0.9')).toBe('10.0.0.9');
    expect(extrairIp(h(null), 0, 'lixo')).toBe('desconhecido');
  });

  it('hops 1 usa a última entrada; entradas anteriores forjadas não valem', () => {
    expect(extrairIp(h('9.9.9.9, 203.0.113.7'), 1)).toBe('203.0.113.7');
    expect(extrairIp(h('203.0.113.7'), 1)).toBe('203.0.113.7');
  });

  it('hops N usa a N-ésima da direita; menos entradas que hops → desconhecido', () => {
    expect(extrairIp(h('1.1.1.1, 2.2.2.2, 3.3.3.3'), 2)).toBe('2.2.2.2');
    expect(extrairIp(h('1.1.1.1'), 2)).toBe('desconhecido');
    expect(extrairIp(h(null), 1)).toBe('desconhecido');
  });

  it('normaliza ::ffff:a.b.c.d, colchetes e caixa; mantém o IPv6 completo', () => {
    expect(extrairIp(h('::ffff:198.51.100.4'), 1)).toBe('198.51.100.4');
    expect(extrairIp(h('[2001:DB8::1]'), 1)).toBe('2001:db8::1');
    expect(extrairIp(h('2001:db8:0:0:0:0:0:2'), 1)).toBe('2001:db8:0:0:0:0:0:2');
  });

  it('ilegível, vazio ou enorme → desconhecido; hops inválido lança', () => {
    expect(extrairIp(h('abc'), 1)).toBe('desconhecido');
    expect(extrairIp(h('   '), 1)).toBe('desconhecido');
    expect(extrairIp(h('1'.repeat(80)), 1)).toBe('desconhecido');
    expect(extrairIp(h('999.1.1.1'), 1)).toBe('desconhecido');
    expect(() => extrairIp(h('1.1.1.1'), -1)).toThrow(RangeError);
    expect(() => extrairIp(h('1.1.1.1'), 1.5)).toThrow(RangeError);
  });
});
