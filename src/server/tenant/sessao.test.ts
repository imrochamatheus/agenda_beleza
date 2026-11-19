import { afterEach, describe, expect, it, vi } from 'vitest';

import { encerrarPrisma } from '@/server/repos/db';

import { NaoAutenticado } from './erros';
import { NOME_COOKIE_SESSAO, hashDoToken, resolverAdmin, resolverTenant } from './sessao';

// Os caminhos com sessão real (expirada, revogada, papéis, TOTP) são cobertos pela integração (T-5).
describe('sessão', () => {
  afterEach(async () => {
    vi.unstubAllEnvs();
    await encerrarPrisma();
  });

  it('usa o cookie ab_sessao e SHA-256 hexadecimal (S-2)', () => {
    expect(NOME_COOKIE_SESSAO).toBe('ab_sessao');
    // Vetor de teste do FIPS 180-2 para "abc".
    expect(hashDoToken('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(hashDoToken('abc')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('responde NaoAutenticado sem credencial ou com token vazio, sem consultar o banco', async () => {
    // Banco inacessível: se houvesse consulta, o erro seria de conexão, não NaoAutenticado.
    vi.stubEnv('DATABASE_URL', 'postgresql://usuario:senha@127.0.0.1:1/z');
    for (const credencial of [null, { token: '' }]) {
      await expect(resolverTenant(credencial)).rejects.toBeInstanceOf(NaoAutenticado);
      await expect(resolverAdmin(credencial)).rejects.toBeInstanceOf(NaoAutenticado);
    }
  });

  it('propaga erro de infraestrutura (não o converte em 401)', async () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://usuario:senha@127.0.0.1:1/z');
    const erro = await resolverTenant({ token: 'qualquer' }).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(Error);
    expect(erro).not.toBeInstanceOf(NaoAutenticado);
  });
});
