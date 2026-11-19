import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { contextoDeSistema } from '@/server/tenant/context';
import type { PublicoContext } from '@/server/tenant/context';
import { NaoEncontrado } from '@/server/tenant/erros';

import { encerrarPrisma } from './db';
import { listarProfissionaisPublicos, listarServicosPublicos, resolverSalaoPorSlug } from './publico';

// Banco inacessível: os casos abaixo respondem antes de consultar. O CA-12 com dados é da T-5.
describe('leituras públicas sem consultar o banco', () => {
  beforeEach(() => {
    vi.stubEnv('DATABASE_URL', 'postgresql://usuario:senha@127.0.0.1:1/z');
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await encerrarPrisma();
  });

  it('slug vazio → NaoEncontrado', async () => {
    await expect(resolverSalaoPorSlug('')).rejects.toBeInstanceOf(NaoEncontrado);
    await expect(resolverSalaoPorSlug(undefined as unknown as string)).rejects.toBeInstanceOf(
      NaoEncontrado,
    );
  });

  it('listagens públicas recusam contexto que não é PublicoContext', async () => {
    const sistema = contextoDeSistema(
      '0b0c5f6e-4a7d-4f0a-9a43-1f7f3c1e2d10',
      'worker',
    ) as unknown as PublicoContext;
    await expect(listarServicosPublicos(sistema)).rejects.toThrow('leitura pública exige PublicoContext');
    await expect(listarProfissionaisPublicos(sistema)).rejects.toThrow(
      'leitura pública exige PublicoContext',
    );
  });
});
