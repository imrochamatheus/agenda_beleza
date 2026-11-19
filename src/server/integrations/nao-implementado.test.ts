import { describe, expect, it } from 'vitest';

import { NaoImplementado } from './nao-implementado';

describe('NaoImplementado (CA-9)', () => {
  it.each(['E6.6', 'E7.2'] as const)('cita o item pendente %s na mensagem', (item) => {
    const erro = new NaoImplementado(item);
    expect(erro).toBeInstanceOf(Error);
    expect(erro.name).toBe('NaoImplementado');
    expect(erro.item).toBe(item);
    expect(erro.message).toBe(`Adaptador real ainda não implementado (${item}).`);
  });
});
