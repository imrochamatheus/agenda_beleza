import { describe, expect, it } from 'vitest';

import { SEGREDO_AVALIACAO_DE_DESENVOLVIMENTO, segredoDeAvaliacao } from './config';

describe('segredoDeAvaliacao (D-2)', () => {
  it('usa o valor informado', () => {
    expect(segredoDeAvaliacao({ AVALIACAO_SEGREDO: 'x'.repeat(40) })).toBe('x'.repeat(40));
    expect(segredoDeAvaliacao({ AVALIACAO_SEGREDO: 'x'.repeat(32), NODE_ENV: 'production' })).toBe('x'.repeat(32));
  });
  it('fora de produção, sem valor: padrão fixo de desenvolvimento (com mais de 32 caracteres)', () => {
    expect(segredoDeAvaliacao({})).toBe(SEGREDO_AVALIACAO_DE_DESENVOLVIMENTO);
    expect(segredoDeAvaliacao({ AVALIACAO_SEGREDO: '', NODE_ENV: 'test' })).toBe(SEGREDO_AVALIACAO_DE_DESENVOLVIMENTO);
    expect(SEGREDO_AVALIACAO_DE_DESENVOLVIMENTO.length).toBeGreaterThanOrEqual(32);
  });
  it('em produção, sem valor: lança', () => {
    expect(() => segredoDeAvaliacao({ NODE_ENV: 'production' })).toThrow('AVALIACAO_SEGREDO é obrigatório em produção');
    expect(() => segredoDeAvaliacao({ NODE_ENV: 'production', AVALIACAO_SEGREDO: '' })).toThrow();
  });
  it('curto demais: lança, também fora de produção', () => {
    expect(() => segredoDeAvaliacao({ AVALIACAO_SEGREDO: 'curto' })).toThrow('ao menos 32');
  });
});
