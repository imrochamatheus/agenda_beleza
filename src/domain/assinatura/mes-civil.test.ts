import { describe, expect, it } from 'vitest';

import { somarUmMesCivilUtc } from './mes-civil';

const d = (s: string) => new Date(s);

describe('somarUmMesCivilUtc (CA-10)', () => {
  it.each([
    ['2027-01-31T00:00:00.000Z', '2027-02-28T00:00:00.000Z'],
    ['2027-03-31T00:00:00.000Z', '2027-04-30T00:00:00.000Z'],
    ['2028-01-29T00:00:00.000Z', '2028-02-29T00:00:00.000Z'],
    ['2027-01-29T10:30:15.123Z', '2027-02-28T10:30:15.123Z'],
    ['2027-12-31T23:59:59.999Z', '2028-01-31T23:59:59.999Z'],
    ['2027-03-10T00:00:00.000Z', '2027-04-10T00:00:00.000Z'],
  ])('%s -> %s', (entrada, esperado) => {
    expect(somarUmMesCivilUtc(d(entrada)).toISOString()).toBe(esperado);
  });
});
