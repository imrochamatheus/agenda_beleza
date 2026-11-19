import { describe, expect, it } from 'vitest';

import { NOME_COOKIE_SESSAO, atributosCookieApagado, atributosCookieSessao } from './cookie';

// CA-7 (RN-11): atributos do cookie de sessão; Secure só em produção.
const TRINTA_DIAS_S = 30 * 24 * 60 * 60;

describe('CA-7: atributos do cookie de sessão', () => {
  it('CA-7: nome ab_sessao', () => {
    expect(NOME_COOKIE_SESSAO).toBe('ab_sessao');
  });

  it('CA-7: production → Secure; HttpOnly, SameSite=Lax, Path=/, Max-Age 30 d, sem Domain', () => {
    const a = atributosCookieSessao('production');
    expect(a).toEqual({ httpOnly: true, sameSite: 'lax', path: '/', secure: true, maxAge: TRINTA_DIAS_S });
    expect(a).not.toHaveProperty('domain');
    expect(a).not.toHaveProperty('expires');
  });

  it.each(['development', 'test', undefined, 'Production'])('CA-7: %s → sem Secure', (env) => {
    expect(atributosCookieSessao(env).secure).toBe(false);
  });

  it('CA-7: padrão lê NODE_ENV do processo (test → sem Secure)', () => {
    expect(process.env.NODE_ENV).toBe('test');
    expect(atributosCookieSessao().secure).toBe(false);
    expect(atributosCookieApagado().secure).toBe(false);
  });

  it.each(['production', 'development'])('CA-7: apagamento (%s) usa os mesmos atributos com Max-Age 0', (env) => {
    expect(atributosCookieApagado(env)).toEqual({ ...atributosCookieSessao(env), maxAge: 0 });
  });
});
