/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';

import { CAPACIDADES } from '@/server/tenant/context';
import { METADADOS_ACAO, metadadosDaAcao } from '@/server/tenant/define-acao';
import { verificarAcoes } from '@/server/tenant/registro';

// CA-4 (RN-5, RN-6): toda exportação de `src/**/*.acao.ts` é produto de defineAcao com capacidade válida.
// A E0.5 não cria ações de produto (S-4): para o teste não ficar vacuamente verde, a MESMA função
// verificadora é exercitada contra fixtures (uma válida e três inválidas), que ela acusa pelo nome.

const acoesDeProduto = import.meta.glob<Record<string, unknown>>('/src/**/*.acao.ts', { eager: true });
const fixtures = import.meta.glob<Record<string, unknown>>('./fixtures/registro/*.acao.ts', { eager: true });

describe('CA-4: registro de ações', () => {
  it('CA-4: todas as ações de produto (src/**/*.acao.ts) declaram papeis e capacidade válidos', () => {
    expect(verificarAcoes(acoesDeProduto)).toEqual([]);
  });

  it('CA-4: os fixtures foram carregados pelo mesmo mecanismo (import.meta.glob)', () => {
    expect(Object.keys(fixtures).sort()).toEqual([
      './fixtures/registro/capacidade-invalida.acao.ts',
      './fixtures/registro/sem-capacidade.acao.ts',
      './fixtures/registro/sem-define-acao.acao.ts',
      './fixtures/registro/valida.acao.ts',
    ]);
  });

  it('CA-4: a verificação acusa pelo nome as três exportações inválidas e só elas', () => {
    expect(verificarAcoes(fixtures)).toEqual([
      {
        arquivo: './fixtures/registro/capacidade-invalida.acao.ts',
        exportacao: 'acaoCapacidadeInvalida',
        motivo: 'capacidade_invalida',
      },
      {
        arquivo: './fixtures/registro/sem-capacidade.acao.ts',
        exportacao: 'acaoSemCapacidade',
        motivo: 'sem_capacidade',
      },
      { arquivo: './fixtures/registro/sem-define-acao.acao.ts', exportacao: 'acaoCrua', motivo: 'nao_e_acao' },
    ]);
  });

  it('CA-4: os fixtures inválidos fazem o registro falhar (a mesma asserção do teste de produto)', () => {
    expect(() => expect(verificarAcoes({ ...acoesDeProduto, ...fixtures })).toEqual([])).toThrow();
  });

  it('CA-4: a ação válida expõe os metadados legíveis em tempo de execução', () => {
    const valida = fixtures['./fixtures/registro/valida.acao.ts'];
    expect(metadadosDaAcao(valida.acaoValida)).toEqual({ papeis: ['gestor'], capacidade: 'configurar' });
    expect(metadadosDaAcao(valida.outraValida)).toEqual({ papeis: ['gestor', 'profissional'], capacidade: 'leitura' });
    expect(CAPACIDADES).toContain(
      (valida.acaoValida as Record<typeof METADADOS_ACAO, { capacidade: string }>)[METADADOS_ACAO].capacidade,
    );
  });

  it('CA-4: a ação sem capacidade carrega, mas recusa executar (fail closed)', async () => {
    const semCapacidade = fixtures['./fixtures/registro/sem-capacidade.acao.ts'].acaoSemCapacidade as {
      executar(c: null, i: unknown): Promise<unknown>;
    };
    await expect(semCapacidade.executar(null, {})).rejects.toThrow('ação sem papeis ou capacidade válidos');
  });
});
