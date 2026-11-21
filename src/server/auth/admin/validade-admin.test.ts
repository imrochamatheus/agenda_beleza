import { describe, expect, it } from 'vitest';

import { atributosCookieAdmin, atributosCookieAdminApagado, atributosCookiePreauth, NOME_COOKIE_ADMIN } from './cookie-admin';
import {
  INATIVIDADE_ADMIN_MS,
  PREAUTH_MS,
  TETO_ADMIN_MS,
  expiracaoAdmin,
  expiracaoPreauth,
  precisaRenovarAdmin,
} from './validade-admin';

// CA-9 (parte pura): relógio injetado.
const base = new Date('2026-11-21T12:00:00.000Z');
const mais = (d: Date, ms: number) => new Date(d.getTime() + ms);

describe('validade da sessão admin', () => {
  it('pré-sessão expira em 10 min', () => {
    expect(PREAUTH_MS).toBe(600_000);
    expect(expiracaoPreauth(base)).toEqual(mais(base, 600_000));
  });
  it('sessão admin: 30 min de inatividade e teto de 8 h', () => {
    expect(INATIVIDADE_ADMIN_MS).toBe(1_800_000);
    expect(TETO_ADMIN_MS).toBe(28_800_000);
    expect(expiracaoAdmin(base, mais(base, 60_000))).toEqual(mais(base, 60_000 + 1_800_000));
    const quaseTeto = mais(base, TETO_ADMIN_MS - 60_000);
    expect(expiracaoAdmin(base, quaseTeto)).toEqual(mais(base, TETO_ADMIN_MS));
  });
  it('renova no máximo uma vez por minuto', () => {
    expect(precisaRenovarAdmin(null, base)).toBe(true);
    expect(precisaRenovarAdmin(mais(base, -30_000), base)).toBe(false);
    expect(precisaRenovarAdmin(mais(base, -60_000), base)).toBe(false);
    expect(precisaRenovarAdmin(mais(base, -60_001), base)).toBe(true);
  });
});

describe('cookie ab_admin', () => {
  it('tem os atributos exigidos', () => {
    expect(NOME_COOKIE_ADMIN).toBe('ab_admin');
    expect(atributosCookieAdmin('development')).toEqual({
      httpOnly: true,
      sameSite: 'strict',
      path: '/admin',
      secure: false,
      maxAge: 28_800,
    });
    expect(atributosCookieAdmin('production').secure).toBe(true);
    expect(atributosCookiePreauth('production').maxAge).toBe(600);
    expect(atributosCookieAdminApagado('production')).toMatchObject({ maxAge: 0, path: '/admin', secure: true });
  });
});
