import { describe, expect, it } from 'vitest';

import { somarDias, somarUmMes } from './datas';

const utc = (iso: string) => new Date(iso);

describe('somarDias', () => {
  it('soma n × 24 h em UTC', () => {
    expect(somarDias(utc('2026-11-19T13:45:10.123Z'), 30).toISOString()).toBe('2026-12-19T13:45:10.123Z');
    expect(somarDias(utc('2026-01-31T00:00:00.000Z'), 1).toISOString()).toBe('2026-02-01T00:00:00.000Z');
  });

  it('atravessa a mudança de horário de verão de outros fusos sem perder horas (UTC)', () => {
    // 2026-03-08 é o início do horário de verão nos EUA; em UTC o dia continua com 24 h.
    expect(somarDias(utc('2026-03-07T12:00:00.000Z'), 2).toISOString()).toBe('2026-03-09T12:00:00.000Z');
  });

  it('aceita n = 0 e n negativo', () => {
    expect(somarDias(utc('2026-05-10T08:00:00.000Z'), 0).toISOString()).toBe('2026-05-10T08:00:00.000Z');
    expect(somarDias(utc('2026-05-10T08:00:00.000Z'), -10).toISOString()).toBe('2026-04-30T08:00:00.000Z');
  });

  it('não altera a data recebida', () => {
    const d = utc('2026-05-10T08:00:00.000Z');
    somarDias(d, 3);
    expect(d.toISOString()).toBe('2026-05-10T08:00:00.000Z');
  });
});

describe('somarUmMes (R-10)', () => {
  it.each([
    ['dia comum', '2026-11-19T13:45:10.123Z', '2026-12-19T13:45:10.123Z'],
    ['31/jan → 28/fev (ano comum)', '2026-01-31T10:00:00.000Z', '2026-02-28T10:00:00.000Z'],
    ['31/jan → 29/fev (ano bissexto)', '2028-01-31T10:00:00.000Z', '2028-02-29T10:00:00.000Z'],
    ['30/jan → 28/fev (ano comum)', '2026-01-30T10:00:00.000Z', '2026-02-28T10:00:00.000Z'],
    ['29/fev → 29/mar', '2028-02-29T10:00:00.000Z', '2028-03-29T10:00:00.000Z'],
    ['31/mar → 30/abr', '2026-03-31T23:59:59.999Z', '2026-04-30T23:59:59.999Z'],
    ['31/dez → 31/jan do ano seguinte', '2026-12-31T03:00:00.000Z', '2027-01-31T03:00:00.000Z'],
    ['15/dez → 15/jan do ano seguinte', '2026-12-15T00:00:00.000Z', '2027-01-15T00:00:00.000Z'],
    ['31/ago → 30/set', '2026-08-31T12:00:00.000Z', '2026-09-30T12:00:00.000Z'],
  ])('%s', (_nome, de, para) => {
    expect(somarUmMes(utc(de)).toISOString()).toBe(para);
  });

  it('não altera a data recebida', () => {
    const d = utc('2026-01-31T10:00:00.000Z');
    somarUmMes(d);
    expect(d.toISOString()).toBe('2026-01-31T10:00:00.000Z');
  });
});
