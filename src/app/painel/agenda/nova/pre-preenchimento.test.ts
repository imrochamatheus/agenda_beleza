import { describe, expect, it } from 'vitest';

import { dataIso, horaTexto, valoresIniciais } from './pre-preenchimento';

// D-029 CA-15: query de pré-preenchimento; valor ruim vale como ausente.
const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const hoje = { ano: 2026, mes: 3, dia: 5 };
const o = { profissionaisValidos: [A, B], fixo: null, hoje };

describe('valoresIniciais', () => {
  it('usa profissional, data e hora válidos', () => {
    expect(valoresIniciais({ profissional: B.toUpperCase(), data: '2026-12-01', hora: '9:30' }, o)).toMatchObject({
      profissionalId: B,
      data: '2026-12-01',
      hora: '09:30',
    });
  });
  it('ausente, repetido, malformado ou de fora do salão vira vazio (data = hoje)', () => {
    const v = valoresIniciais({ profissional: [A, B], data: ['2026-12-01'], hora: '99:99' }, o);
    expect(v).toMatchObject({ profissionalId: '', data: '2026-03-05', hora: '' });
    expect(valoresIniciais({ profissional: '00000000-0000-4000-8000-0000000000ff', data: '2026-02-30' }, o)).toMatchObject({ profissionalId: '', data: '2026-03-05' });
    expect(valoresIniciais({ profissional: 'abc' }, o).profissionalId).toBe('');
  });
  it('o profissional fixo vence o que veio na query', () => {
    expect(valoresIniciais({ profissional: B }, { ...o, fixo: A }).profissionalId).toBe(A);
  });
  it('formatadores com zeros à esquerda', () => {
    expect(dataIso({ ano: 2026, mes: 1, dia: 2 })).toBe('2026-01-02');
    expect(horaTexto(65)).toBe('01:05');
  });
});
