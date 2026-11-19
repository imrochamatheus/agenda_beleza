import { describe, expect, it } from 'vitest';

import { CAPACIDADES, criarTenantContext } from './context';
import { permitirTudo, politicaDeOperacao } from './politica';

describe('política de operação', () => {
  it('padrão permite toda capacidade (E6.4 troca a política em vigor)', async () => {
    const ctx = criarTenantContext({
      usuarioId: '5d2a9b1c-3e4f-4a5b-8c6d-7e8f9a0b1c2d',
      papel: 'gestor',
      salaoId: '0b0c5f6e-4a7d-4f0a-9a43-1f7f3c1e2d10',
      profissionalId: null,
    });
    expect(politicaDeOperacao).toBe(permitirTudo);
    for (const capacidade of CAPACIDADES) {
      expect(await politicaDeOperacao(ctx, capacidade)).toEqual({ permitido: true });
    }
  });
});
