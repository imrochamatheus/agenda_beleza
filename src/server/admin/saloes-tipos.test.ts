import { describe, expect, it } from 'vitest';

import { DIAS_MAX, DIAS_MIN, DIA_MS, ESTADOS_FILTRO, FOLGA_TESTE_MS, MENSAGEM_DE_RECUSA, MENSAGENS_ADMIN_SALOES, MOTIVO_MAX, MOTIVO_MIN } from './saloes-tipos';

describe('contratos dos salões do admin', () => {
  it('limites e constantes', () => {
    expect([MOTIVO_MIN, MOTIVO_MAX, DIAS_MIN, DIAS_MAX]).toEqual([5, 280, 1, 90]);
    expect(FOLGA_TESTE_MS).toBe(300_000);
    expect(DIA_MS).toBe(86_400_000);
  });
  it('o filtro tem os 6 estados vigentes e sem_assinatura (encerrada equivale a sem assinatura)', () => {
    expect(ESTADOS_FILTRO).toEqual(['pendente', 'em_teste', 'ativa', 'em_carencia', 'suspensa', 'cancelada', 'sem_assinatura']);
  });
  it('toda recusa tem texto próprio e as mensagens não ecoam valores', () => {
    expect(Object.keys(MENSAGEM_DE_RECUSA).sort()).toEqual(['estado', 'sem_assinatura', 'sem_provedor', 'teste_encerrado', 'teste_expirando']);
    expect(new Set(Object.values(MENSAGEM_DE_RECUSA)).size).toBe(5);
    for (const m of Object.values(MENSAGENS_ADMIN_SALOES)) expect(m).toMatch(/\S/);
  });
});
