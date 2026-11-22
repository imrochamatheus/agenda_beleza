import { describe, expect, it } from 'vitest';

import { deslocamentoDaPagina, lerPaginaAdmin, totalDePaginas, unico } from './paginacao';

describe('paginação do admin (D-045 RN-13)', () => {
  it.each([
    [undefined, 1],
    ['abc', 1],
    ['0', 1],
    ['-3', 1],
    ['1.5', 1],
    ['', 1],
    ['3', 3],
    ['500', 500],
    ['501', 500],
    ['9999999', 500],
    ['99999999', 1],
  ])('página %j → %i', (entrada, esperado) => {
    expect(lerPaginaAdmin(entrada)).toBe(esperado);
  });

  it('deslocamento e total de páginas', () => {
    expect(deslocamentoDaPagina(1)).toBe(0);
    expect(deslocamentoDaPagina(500)).toBe(9980);
    expect(totalDePaginas(0)).toBe(1);
    expect(totalDePaginas(20)).toBe(1);
    expect(totalDePaginas(21)).toBe(2);
  });

  it('unico ignora lista e ausente', () => {
    expect(unico('a')).toBe('a');
    expect(unico(['a', 'b'])).toBeUndefined();
    expect(unico(undefined)).toBeUndefined();
  });
});
