import { describe, expect, it } from 'vitest';

import { criarTenantContext } from '@/server/tenant/context';
import type { PapelDeSalao } from '@/server/tenant/context';
import { AcessoNegado } from '@/server/tenant/erros';

import { MATRIZ, OPERACOES, exigirPermissao, filtroDeProfissional, pode } from './permissoes';
import type { Escopo, Operacao } from './permissoes';

// CA-11 (RN-18): a matriz inteira, escrita aqui de forma independente, e os auxiliares de escopo.
// Este é o teste que a issue chama de tests/unit/auth/permissoes.test.ts (D-12: convenção src/**).

const ESPERADO: Record<Operacao, [Escopo, Escopo, Escopo]> = {
  //                              gestor    profissional  super_admin
  'painel.acessar': ['salao', 'proprio', 'negado'],
  'agenda.ver': ['salao', 'proprio', 'negado'],
  'reserva.criar': ['salao', 'proprio', 'negado'],
  'reserva.alterar': ['salao', 'proprio', 'negado'],
  'bloqueio_profissional.gerir': ['salao', 'proprio', 'negado'],
  'bloqueio_salao.gerir': ['salao', 'negado', 'negado'],
  'jornada.editar': ['salao', 'negado', 'negado'],
  'servico.gerir': ['salao', 'negado', 'negado'],
  'profissional.gerir': ['salao', 'negado', 'negado'],
  'cliente.gerir': ['salao', 'negado', 'negado'],
  'salao.configurar': ['salao', 'negado', 'negado'],
  'assinatura.gerir': ['salao', 'negado', 'negado'],
  'plataforma.administrar': ['negado', 'negado', 'plataforma'],
};

const PAPEIS = ['gestor', 'profissional', 'super_admin'] as const;

const SALAO = '00000000-0000-4000-8000-000000000001';
const USUARIO = '00000000-0000-4000-8000-000000000002';
const PROF_PROPRIO = '00000000-0000-4000-8000-000000000003';
const PROF_OUTRO = '00000000-0000-4000-8000-000000000004';

const ctx = (papel: PapelDeSalao, profissionalId: string | null) =>
  criarTenantContext({ usuarioId: USUARIO, papel, salaoId: SALAO, profissionalId });

describe('CA-11: matriz de permissões', () => {
  it('CA-11: as operações são exatamente as da tabela esperada', () => {
    expect([...OPERACOES].sort()).toEqual(Object.keys(ESPERADO).sort());
    expect(Object.keys(MATRIZ).sort()).toEqual(Object.keys(ESPERADO).sort());
  });

  it.each(Object.entries(ESPERADO).flatMap(([op, v]) => PAPEIS.map((p, i) => [op, p, v[i]] as const)))(
    'CA-11: %s × %s → %s',
    (operacao, papel, escopo) => {
      expect(pode(papel, operacao)).toBe(escopo);
      expect(MATRIZ[operacao as Operacao][papel]).toBe(escopo);
    },
  );

  it('CA-11: papel ou operação desconhecidos → negado (falha fechada)', () => {
    for (const papel of ['cliente', undefined, null, 'toString', '__proto__', 'constructor', 42, '']) {
      expect(pode(papel, 'agenda.ver')).toBe('negado');
    }
    for (const op of ['inexistente', 'toString', '__proto__', undefined, 7, 'hasOwnProperty']) {
      expect(pode('gestor', op)).toBe('negado');
    }
  });

  it('CA-11: matriz congelada em profundidade', () => {
    expect(Object.isFrozen(MATRIZ)).toBe(true);
    for (const op of OPERACOES) {
      expect(Object.isFrozen(MATRIZ[op])).toBe(true);
    }
  });
});

describe('CA-11: exigirPermissao', () => {
  it('CA-11: profissional sobre recurso próprio → permitido; de outro profissional → AcessoNegado', () => {
    const p = ctx('profissional', PROF_PROPRIO);
    expect(() => exigirPermissao(p, 'reserva.alterar', { profissionalId: PROF_PROPRIO })).not.toThrow();
    expect(() => exigirPermissao(p, 'reserva.alterar', { profissionalId: PROF_OUTRO })).toThrow(AcessoNegado);
    expect(() => exigirPermissao(p, 'reserva.alterar', { profissionalId: null })).toThrow(AcessoNegado);
    // Sem alvo: checagem de operação (DD-2).
    expect(() => exigirPermissao(p, 'agenda.ver')).not.toThrow();
  });

  it('CA-11: ctx.profissionalId nulo com escopo proprio → AcessoNegado', () => {
    const semPerfil = ctx('profissional', null);
    expect(() => exigirPermissao(semPerfil, 'agenda.ver')).toThrow(AcessoNegado);
    expect(() => exigirPermissao(semPerfil, 'agenda.ver', { profissionalId: null })).toThrow(AcessoNegado);
  });

  it('CA-11: gestor sobre qualquer profissionalId → permitido (inclusive sem perfil)', () => {
    for (const g of [ctx('gestor', PROF_PROPRIO), ctx('gestor', null)]) {
      for (const op of OPERACOES.filter((o) => o !== 'plataforma.administrar')) {
        expect(() => exigirPermissao(g, op, { profissionalId: PROF_OUTRO })).not.toThrow();
        expect(() => exigirPermissao(g, op)).not.toThrow();
      }
    }
  });

  it('CA-11: operação negada ao profissional (ex.: editar jornada) → AcessoNegado', () => {
    const p = ctx('profissional', PROF_PROPRIO);
    for (const op of ['jornada.editar', 'servico.gerir', 'cliente.gerir', 'bloqueio_salao.gerir'] as const) {
      const erro = (() => {
        try {
          exigirPermissao(p, op, { profissionalId: PROF_PROPRIO });
        } catch (e) {
          return e;
        }
      })();
      expect(erro).toBeInstanceOf(AcessoNegado);
      expect((erro as AcessoNegado).status).toBe(403);
    }
  });

  it('CA-11: plataforma.administrar nunca vale para contexto de salão', () => {
    expect(() => exigirPermissao(ctx('gestor', null), 'plataforma.administrar')).toThrow(AcessoNegado);
    expect(() => exigirPermissao(ctx('profissional', PROF_PROPRIO), 'plataforma.administrar')).toThrow(AcessoNegado);
  });
});

describe('CA-11: filtroDeProfissional', () => {
  it('gestor → todos; profissional → só o próprio', () => {
    expect(filtroDeProfissional(ctx('gestor', null), 'agenda.ver')).toEqual({ todos: true });
    expect(filtroDeProfissional(ctx('profissional', PROF_PROPRIO), 'agenda.ver')).toEqual({
      profissionalId: PROF_PROPRIO,
    });
  });

  it('profissional sem perfil, operação negada ou de plataforma → AcessoNegado', () => {
    expect(() => filtroDeProfissional(ctx('profissional', null), 'agenda.ver')).toThrow(AcessoNegado);
    expect(() => filtroDeProfissional(ctx('profissional', PROF_PROPRIO), 'cliente.gerir')).toThrow(AcessoNegado);
    expect(() => filtroDeProfissional(ctx('gestor', null), 'plataforma.administrar')).toThrow(AcessoNegado);
  });
});
