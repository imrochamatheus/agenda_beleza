import { describe, expect, it } from 'vitest';

import { defineAcao } from './define-acao';
import type { ConfigAcao } from './define-acao';
import { verificarAcoes } from './registro';

const handler = async () => null;

// Os fixtures *.acao.ts e o glob sobre src/**/*.acao.ts são da integração (CA-4, T-5).
describe('verificarAcoes', () => {
  it('aceita módulos só com ações válidas (e módulo vazio)', () => {
    expect(
      verificarAcoes({
        '/src/a.acao.ts': {
          ler: defineAcao({ papeis: ['gestor', 'profissional'], capacidade: 'leitura' }, handler),
          agendar: defineAcao({ papeis: ['gestor'], capacidade: 'agendar' }, handler),
        },
        '/src/vazio.acao.ts': {},
      }),
    ).toEqual([]);
    expect(verificarAcoes({})).toEqual([]);
  });

  it('acusa cada exportação inválida pelo arquivo, nome e motivo', () => {
    const problemas = verificarAcoes({
      '/src/z.acao.ts': {
        semCapacidade: defineAcao({ papeis: ['gestor'] } as unknown as ConfigAcao, handler),
        capacidadeNula: defineAcao({ papeis: ['gestor'], capacidade: null } as unknown as ConfigAcao, handler),
        capacidadeInvalida: defineAcao(
          { papeis: ['gestor'], capacidade: 'excluir' } as unknown as ConfigAcao,
          handler,
        ),
        semPapeis: defineAcao({ capacidade: 'configurar' } as unknown as ConfigAcao, handler),
        papeisVazios: defineAcao({ papeis: [], capacidade: 'configurar' } as unknown as ConfigAcao, handler),
        papelAdmin: defineAcao(
          { papeis: ['super_admin'], capacidade: 'configurar' } as unknown as ConfigAcao,
          handler,
        ),
        valida: defineAcao({ papeis: ['gestor'], capacidade: 'lgpd' }, handler),
      },
      '/src/a.acao.ts': {
        funcaoSolta: async () => null,
        constante: 42,
      },
    });
    expect(problemas).toEqual([
      { arquivo: '/src/a.acao.ts', exportacao: 'constante', motivo: 'nao_e_acao' },
      { arquivo: '/src/a.acao.ts', exportacao: 'funcaoSolta', motivo: 'nao_e_acao' },
      { arquivo: '/src/z.acao.ts', exportacao: 'capacidadeInvalida', motivo: 'capacidade_invalida' },
      { arquivo: '/src/z.acao.ts', exportacao: 'capacidadeNula', motivo: 'sem_capacidade' },
      { arquivo: '/src/z.acao.ts', exportacao: 'papeisVazios', motivo: 'sem_papeis' },
      { arquivo: '/src/z.acao.ts', exportacao: 'papelAdmin', motivo: 'sem_papeis' },
      { arquivo: '/src/z.acao.ts', exportacao: 'semCapacidade', motivo: 'sem_capacidade' },
      { arquivo: '/src/z.acao.ts', exportacao: 'semPapeis', motivo: 'sem_papeis' },
    ]);
  });
});
