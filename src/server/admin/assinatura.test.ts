import { describe, expect, it } from 'vitest';

import { CODIGOS_ERRO_WEBHOOK, MAX_CAUSA } from './assinatura-tipos';
import { truncarCausa } from './assinatura';

describe('assinatura no admin (D-045 RN-10/RN-11)', () => {
  it('causa de até 80 caracteres passa inteira; acima é truncada com reticências', () => {
    expect(truncarCausa('pagamento_aprovado')).toBe('pagamento_aprovado');
    expect(truncarCausa('a'.repeat(MAX_CAUSA))).toBe('a'.repeat(MAX_CAUSA));
    const t = truncarCausa('b'.repeat(200));
    expect(Array.from(t)).toHaveLength(MAX_CAUSA + 1);
    expect(t.endsWith('…')).toBe(true);
  });

  it('não parte pontos de código astrais', () => {
    const t = truncarCausa('😀'.repeat(100));
    expect(t).toBe(`${'😀'.repeat(MAX_CAUSA)}…`);
  });

  it('os códigos de erro mostráveis são os 10 do webhook', () => {
    expect(CODIGOS_ERRO_WEBHOOK).toHaveLength(10);
    expect(CODIGOS_ERRO_WEBHOOK).toContain('vinculo_invalido');
    expect(CODIGOS_ERRO_WEBHOOK).not.toContain('Erro: x');
  });
});
