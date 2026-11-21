import { describe, expect, it } from 'vitest';

import {
  EXPIRACAO_PADRAO_JOB_MS,
  LOTE_RECONCILIACAO,
  PRAZO_ENVIANDO_MS,
  PRAZO_PENDENTE_MS,
  TIMEOUT_MAXIMO_ENVIO_MS,
} from './config';

describe('prazos do pipeline (RN-21, A-8)', () => {
  it('valores padrão', () => {
    expect(PRAZO_PENDENTE_MS).toBe(120_000);
    expect(PRAZO_ENVIANDO_MS).toBe(300_000);
    expect(LOTE_RECONCILIACAO).toBe(100);
  });

  it('PRAZO_ENVIANDO é maior que o timeout máximo do envio e menor que a expiração do job', () => {
    expect(PRAZO_ENVIANDO_MS).toBeGreaterThan(TIMEOUT_MAXIMO_ENVIO_MS);
    expect(PRAZO_ENVIANDO_MS).toBeLessThan(EXPIRACAO_PADRAO_JOB_MS);
  });
});
