import { describe, expect, it } from 'vitest';

import {
  CAPACIDADES,
  contextoDeSistema,
  criarAdminContext,
  criarPublicoContext,
  criarTenantContext,
  ehCapacidade,
  ehPapelDeSalao,
  exigirEscopo,
  exigirPublico,
} from './context';
import type { ContextoEscopado, PublicoContext } from './context';

const SALAO = '0b0c5f6e-4a7d-4f0a-9a43-1f7f3c1e2d10';
const USUARIO = '5d2a9b1c-3e4f-4a5b-8c6d-7e8f9a0b1c2d';
const PROFISSIONAL = '9f8e7d6c-5b4a-4321-8fed-cba987654321';

describe('fábricas de contexto', () => {
  it('criam contextos congelados com o discriminante certo', () => {
    const tenant = criarTenantContext({
      usuarioId: USUARIO,
      papel: 'gestor',
      salaoId: SALAO,
      profissionalId: PROFISSIONAL,
    });
    expect(tenant).toEqual({
      tipo: 'tenant',
      usuarioId: USUARIO,
      papel: 'gestor',
      salaoId: SALAO,
      profissionalId: PROFISSIONAL,
    });
    expect(Object.isFrozen(tenant)).toBe(true);
    expect(() => {
      (tenant as unknown as { salaoId: string }).salaoId = USUARIO;
    }).toThrow(TypeError);

    expect(criarAdminContext(USUARIO)).toEqual({ tipo: 'admin', usuarioId: USUARIO });
    expect(criarPublicoContext(SALAO, 'studio-a')).toEqual({
      tipo: 'publico',
      salaoId: SALAO,
      slugAtual: 'studio-a',
    });
    const sistema = contextoDeSistema(SALAO, 'worker');
    expect(sistema).toEqual({ tipo: 'sistema', salaoId: SALAO, origem: 'worker' });
    expect(Object.isFrozen(sistema)).toBe(true);
  });

  it('aceitam profissionalId nulo (gestor sem perfil vinculado)', () => {
    const ctx = criarTenantContext({
      usuarioId: USUARIO,
      papel: 'profissional',
      salaoId: SALAO,
      profissionalId: null,
    });
    expect(ctx.profissionalId).toBeNull();
  });

  it('recusam IDs que não são UUID e papel que não é de salão', () => {
    expect(() => contextoDeSistema('nao-uuid', 'worker')).toThrow('salaoId do contexto deve ser um UUID');
    expect(() => criarAdminContext('x')).toThrow('usuarioId');
    expect(() => criarPublicoContext('', 's')).toThrow('salaoId');
    expect(() =>
      criarTenantContext({ usuarioId: USUARIO, papel: 'gestor', salaoId: SALAO, profissionalId: 'x' }),
    ).toThrow('profissionalId');
    expect(() =>
      criarTenantContext({
        usuarioId: USUARIO,
        papel: 'super_admin' as never,
        salaoId: SALAO,
        profissionalId: null,
      }),
    ).toThrow('papel');
  });
});

describe('exigirEscopo', () => {
  it('devolve o salaoId de TenantContext e SistemaContext', () => {
    const tenant = criarTenantContext({
      usuarioId: USUARIO,
      papel: 'gestor',
      salaoId: SALAO,
      profissionalId: null,
    });
    expect(exigirEscopo(tenant)).toBe(SALAO);
    expect(exigirEscopo(contextoDeSistema(SALAO, 'worker'))).toBe(SALAO);
  });

  it('recusa em tempo de execução admin, publico, nulo e objetos forjados (CA-13)', () => {
    const recusados: unknown[] = [
      criarAdminContext(USUARIO),
      criarPublicoContext(SALAO, 'studio-a'),
      null,
      undefined,
      'tenant',
      { tipo: 'tenant', salaoId: 'nao-uuid' },
      { tipo: 'outro', salaoId: SALAO },
      { salaoId: SALAO },
    ];
    for (const ctx of recusados) {
      expect(() => exigirEscopo(ctx as ContextoEscopado)).toThrow(
        'operação de tenant exige TenantContext ou SistemaContext',
      );
    }
  });
});

describe('exigirPublico', () => {
  it('aceita só PublicoContext', () => {
    expect(exigirPublico(criarPublicoContext(SALAO, 'studio-a'))).toBe(SALAO);
    const recusados: unknown[] = [
      contextoDeSistema(SALAO, 'worker'),
      criarAdminContext(USUARIO),
      null,
      { tipo: 'publico', salaoId: 'x' },
    ];
    for (const ctx of recusados) {
      expect(() => exigirPublico(ctx as PublicoContext)).toThrow('leitura pública exige PublicoContext');
    }
  });
});

describe('papéis e capacidades', () => {
  it('lista as seis capacidades (RN-5 + leitura, S-5)', () => {
    expect([...CAPACIDADES]).toEqual([
      'leitura',
      'configurar',
      'agendar',
      'cancelar',
      'assinatura',
      'lgpd',
    ]);
    expect(CAPACIDADES.every(ehCapacidade)).toBe(true);
    expect(ehCapacidade('excluir')).toBe(false);
    expect(ehCapacidade(undefined)).toBe(false);
  });

  it('reconhece só gestor e profissional como papéis de salão', () => {
    expect(ehPapelDeSalao('gestor')).toBe(true);
    expect(ehPapelDeSalao('profissional')).toBe(true);
    expect(ehPapelDeSalao('super_admin')).toBe(false);
    expect(ehPapelDeSalao(null)).toBe(false);
  });
});
