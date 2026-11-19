import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AcessoNegado, NaoAutenticado } from '@/server/tenant/erros';
import { exigirContexto, lerCredencialDoCookie } from '@/server/tenant/next';

import { criarSessao, criarSuperAdmin } from '../../support/auth';
import { criarSalaoCompleto } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';

// CA-18: exigirContexto() para Server Components. next/headers é substituído (não é mock de banco):
// a sessão do cookie é lida do PostgreSQL real deste worker.

const cookie = vi.hoisted(() => ({ valor: undefined as string | undefined }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (nome: string) =>
      nome === 'ab_sessao' && cookie.valor !== undefined ? { name: nome, value: cookie.valor } : undefined,
  }),
}));

let s: SalaoCompleto;

beforeAll(async () => {
  s = await criarSalaoCompleto();
});
beforeEach(() => {
  cookie.valor = undefined;
});

describe('CA-18: exigirContexto() lê o cookie de sessão e devolve o TenantContext', () => {
  it('CA-18: cookie de sessão válida do gestor → TenantContext da sessão', async () => {
    const { token } = await criarSessao(s.gestor.usuarioId);
    cookie.valor = token;
    expect(await lerCredencialDoCookie()).toEqual({ token });
    const ctx = await exigirContexto();
    expect({ ...ctx }).toEqual({
      tipo: 'tenant',
      usuarioId: s.gestor.usuarioId,
      papel: 'gestor',
      salaoId: s.salaoId,
      profissionalId: s.gestor.profissionalId,
    });
    expect({ ...(await exigirContexto(['gestor'])) }).toEqual({ ...ctx });
  });

  it('CA-18: sem cookie → NaoAutenticado', async () => {
    await expect(exigirContexto()).rejects.toBeInstanceOf(NaoAutenticado);
  });

  it('CA-18: token desconhecido, sessão expirada ou revogada → NaoAutenticado', async () => {
    cookie.valor = 'token-que-nao-existe';
    await expect(exigirContexto()).rejects.toBeInstanceOf(NaoAutenticado);
    cookie.valor = (await criarSessao(s.gestor.usuarioId, { expiraEm: new Date(Date.now() - 1) })).token;
    await expect(exigirContexto()).rejects.toBeInstanceOf(NaoAutenticado);
    cookie.valor = (await criarSessao(s.gestor.usuarioId, { revogadaEm: new Date() })).token;
    await expect(exigirContexto()).rejects.toBeInstanceOf(NaoAutenticado);
  });

  it('CA-18: papel fora de `papeis` → AcessoNegado; super_admin → AcessoNegado', async () => {
    cookie.valor = (await criarSessao(s.profissional.usuarioId)).token;
    await expect(exigirContexto(['gestor'])).rejects.toBeInstanceOf(AcessoNegado);
    expect((await exigirContexto(['gestor', 'profissional'])).profissionalId).toBe(s.profissional.profissionalId);

    const admin = await criarSuperAdmin({ totpVerificado: true });
    cookie.valor = admin.credencial?.token;
    await expect(exigirContexto()).rejects.toBeInstanceOf(AcessoNegado);
  });
});
