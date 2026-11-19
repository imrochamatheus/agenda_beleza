import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { encerrarPrisma } from '@/server/repos/db';

import { NaoAutenticado } from './erros';
import { exigirContexto, lerCredencialDoCookie } from './next';

// next/headers substituído (não é mock de banco). O caminho com sessão válida é integração (CA-18, T-5).
const cookie = vi.hoisted(() => ({ valores: new Map<string, string>() }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (nome: string) => {
      const value = cookie.valores.get(nome);
      return value === undefined ? undefined : { name: nome, value };
    },
  }),
}));

describe('adaptador Next', () => {
  beforeEach(() => {
    cookie.valores.clear();
    vi.stubEnv('DATABASE_URL', 'postgresql://usuario:senha@127.0.0.1:1/z');
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await encerrarPrisma();
  });

  it('lerCredencialDoCookie lê só o cookie ab_sessao', async () => {
    expect(await lerCredencialDoCookie()).toBeNull();
    cookie.valores.set('outro', 'abc');
    expect(await lerCredencialDoCookie()).toBeNull();
    cookie.valores.set('ab_sessao', '');
    expect(await lerCredencialDoCookie()).toBeNull();
    cookie.valores.set('ab_sessao', 'tok');
    expect(await lerCredencialDoCookie()).toEqual({ token: 'tok' });
  });

  it('exigirContexto sem cookie lança NaoAutenticado sem consultar o banco (CA-18)', async () => {
    await expect(exigirContexto()).rejects.toBeInstanceOf(NaoAutenticado);
    await expect(exigirContexto(['gestor'])).rejects.toBeInstanceOf(NaoAutenticado);
  });
});
