import { describe, expect, it } from 'vitest';

import {
  ROTULO_ORIGEM,
  ROTULO_STATUS,
  ROTULO_STATUS_DO_ITEM,
  ROTULO_TOTAL,
  rotuloDaOrigem,
  rotuloDoStatus,
  rotuloDoStatusDoItem,
} from './rotulos';

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
    expect(rotuloDoStatusDoItem('toString')).toBe('toString');
    expect(rotuloDaOrigem('x')).toBe('x');
  });
  it('origem', () => {
    expect(rotuloDaOrigem('publico')).toBe(ROTULO_ORIGEM.publico);
    expect(rotuloDaOrigem('equipe')).toBe('Cadastrada pela equipe');
  });
});

describe('D-050: status do item (masculino, web-design §4.5) e total (RN-35)', () => {
  it('cada status do item tem texto masculino próprio e distinto', () => {
    expect(['confirmado', 'cancelado', 'concluido', 'nao_compareceu'].map(rotuloDoStatusDoItem)).toEqual([
      'Confirmado',
      'Cancelado',
      'Concluído',
      'Não compareceu',
    ]);
    expect(new Set(Object.values(ROTULO_STATUS_DO_ITEM)).size).toBe(4);
  });
  it('rótulos do total', () => {
    expect(ROTULO_TOTAL).toEqual({ reserva: 'Total', seus_servicos: 'Total dos seus serviços', cancelada: 'Total (cancelada)' });
  });
});
