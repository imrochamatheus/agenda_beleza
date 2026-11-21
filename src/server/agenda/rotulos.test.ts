import { describe, expect, it } from 'vitest';

import { ROTULO_ORIGEM, ROTULO_STATUS, rotuloDaOrigem, rotuloDoStatus } from './rotulos';

describe('rótulos textuais (RN-5, CA-12)', () => {
  it('cada status tem texto próprio e distinto', () => {
    expect(rotuloDoStatus('confirmado')).toBe('Confirmada');
    expect(rotuloDoStatus('cancelado')).toBe('Cancelada');
    expect(rotuloDoStatus('concluido')).toBe('Concluída');
    expect(rotuloDoStatus('nao_compareceu')).toBe('Não compareceu');
    expect(new Set(Object.values(ROTULO_STATUS)).size).toBe(4);
  });
  it('valor desconhecido (incluindo chaves do protótipo) volta como veio', () => {
    expect(rotuloDoStatus('novo')).toBe('novo');
    expect(rotuloDoStatus('toString')).toBe('toString');
    expect(rotuloDaOrigem('x')).toBe('x');
  });
  it('origem', () => {
    expect(rotuloDaOrigem('publico')).toBe(ROTULO_ORIGEM.publico);
    expect(rotuloDaOrigem('equipe')).toBe('Cadastrada pela equipe');
  });
});
