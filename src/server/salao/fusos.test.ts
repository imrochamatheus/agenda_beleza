import { describe, expect, it } from 'vitest';

import { fusosCanonicos } from '@/server/tempo/fuso';

import { FUSOS_BRASIL, opcoesDeFuso } from './fusos';

// D-017 T-4: opções do <select> de fuso (RN-9, RN-19, D-25). Sem fixar o tamanho da lista do ICU (R-4).

describe('FUSOS_BRASIL', () => {
  it('16 fusos, São Paulo primeiro, todos presentes na lista do runtime, rótulo com o nome IANA', () => {
    expect(FUSOS_BRASIL).toHaveLength(16);
    expect(FUSOS_BRASIL[0]).toEqual({ valor: 'America/Sao_Paulo', rotulo: 'Brasília e São Paulo (America/Sao_Paulo)' });
    const lista = fusosCanonicos();
    for (const f of FUSOS_BRASIL) {
      expect(lista, f.valor).toContain(f.valor);
      expect(f.rotulo.endsWith(`(${f.valor})`)).toBe(true);
    }
    expect(new Set(FUSOS_BRASIL.map((f) => f.valor)).size).toBe(16);
    expect(FUSOS_BRASIL.find((f) => f.valor === 'America/Bahia')?.rotulo).toBe('Salvador (America/Bahia)');
    expect(Object.isFrozen(FUSOS_BRASIL)).toBe(true);
  });
});

describe('opcoesDeFuso', () => {
  it('brasil na ordem da constante; outros = canônicos restantes na ordem do ICU; nenhum do Brasil em outros', () => {
    const o = opcoesDeFuso('America/Sao_Paulo');
    expect(o.atualForaDaLista).toBeNull();
    expect(o.brasil.map((f) => f.valor)).toEqual(FUSOS_BRASIL.map((f) => f.valor));
    const brasil = new Set(FUSOS_BRASIL.map((f) => f.valor));
    expect(o.outros.some((f) => brasil.has(f.valor))).toBe(false);
    expect(o.outros.map((f) => f.valor)).toEqual(fusosCanonicos().filter((v) => !brasil.has(v)));
    expect(o.outros.every((f) => f.rotulo === f.valor)).toBe(true);
    expect(o.brasil.length + o.outros.length).toBe(fusosCanonicos().length);
  });

  it('atualForaDaLista só para valor gravado não canônico', () => {
    expect(opcoesDeFuso('Brazil/East').atualForaDaLista).toEqual({ valor: 'Brazil/East', rotulo: 'Brazil/East (atual)' });
    expect(opcoesDeFuso('America/Manaus').atualForaDaLista).toBeNull();
    expect(opcoesDeFuso(null).atualForaDaLista).toBeNull();
    expect(opcoesDeFuso('').atualForaDaLista).toBeNull();
  });

  it('as opções devolvidas são cópias (alterá-las não muda FUSOS_BRASIL)', () => {
    const o = opcoesDeFuso(null);
    o.brasil[0].rotulo = 'x';
    expect(FUSOS_BRASIL[0].rotulo).not.toBe('x');
  });
});
