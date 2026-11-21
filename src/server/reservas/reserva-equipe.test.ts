import { describe, expect, it } from 'vitest';

import { lerData, lerHora } from './reserva-equipe';

// D-029 RN-5: leitura estrita de data e hora do formulário (sem banco, sem relógio).
describe('lerData', () => {
  it('aceita AAAA-MM-DD válido, com espaços nas pontas', () => {
    expect(lerData('2026-12-01')).toEqual({ ano: 2026, mes: 12, dia: 1 });
    expect(lerData(' 2028-02-29 ')).toEqual({ ano: 2028, mes: 2, dia: 29 });
  });
  it.each(['2026-02-30', '2026-13-01', '01/12/2026', '2026-1-1', '', '2026-12-01T10:00', 20261201, null, undefined, {}])(
    'recusa %j',
    (v) => expect(lerData(v)).toBeNull(),
  );
});

describe('lerHora', () => {
  it('converte HH:MM e H:MM em minutos do dia', () => {
    expect(lerHora('00:00')).toBe(0);
    expect(lerHora('9:05')).toBe(545);
    expect(lerHora(' 23:59 ')).toBe(1439);
  });
  it.each(['24:00', '12:60', '12', '12:5', 'ab:cd', '', 1200, null, undefined])('recusa %j', (v) => expect(lerHora(v)).toBeNull());
});
