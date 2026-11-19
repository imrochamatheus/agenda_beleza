import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  formatarData,
  formatarDataHora,
  formatarDeslocamentoUtc,
  formatarHora,
  formatarMoeda,
  FUSO_PADRAO,
} from './format';

const NBSP = ' ';
const SP = 'America/Sao_Paulo';
const d = (iso: string) => new Date(iso);

describe('formatarMoeda (CA-1, CA-5)', () => {
  it('CA-1: 7900 centavos → "R$ 79,00" com NBSP (U+00A0), nunca U+0020', () => {
    expect(formatarMoeda(7900)).toBe(`R$${NBSP}79,00`);
    expect(formatarMoeda(7900)).not.toBe('R$ 79,00');
  });

  it.each([
    [0, '0,00'],
    [5, '0,05'],
    [99, '0,99'],
    [100, '1,00'],
    [1999, '19,99'],
    [100000, '1.000,00'],
    [123456789, '1.234.567,89'],
    [Number.MAX_SAFE_INTEGER, '90.071.992.547.409,91'],
  ])('CA-5: %d → R$ %s', (centavos, esperado) => {
    const saida = formatarMoeda(centavos);
    expect(saida).toBe(`R$${NBSP}${esperado}`);
    expect(saida).toMatch(/^R\$ \d{1,3}(\.\d{3})*,\d{2}$/);
    expect(saida).not.toMatch(/[   ]/);
  });

  it.each([79.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'CA-5: %d não é inteiro seguro → RangeError',
    (valor) => {
      expect(() => formatarMoeda(valor)).toThrow(RangeError);
      expect(() => formatarMoeda(valor)).toThrow(/inteiro seguro/);
    },
  );

  it.each([-1, -7900])('CA-5 (D-13): negativo %d → RangeError', (valor) => {
    expect(() => formatarMoeda(valor)).toThrow(RangeError);
    expect(() => formatarMoeda(valor)).toThrow(/não pode ser negativo/);
  });

  it('CA-5: texto (forçado) → TypeError', () => {
    expect(() => formatarMoeda('7900' as never)).toThrow(TypeError);
  });
});

describe('formatarData / formatarHora / formatarDataHora (CA-2, CA-6, CA-7, CA-8)', () => {
  it('CA-2: 2026-03-10T13:00:00Z em America/Sao_Paulo → 10/03/2026 10:00 (U+0020, sem vírgula)', () => {
    const instante = d('2026-03-10T13:00:00Z');
    expect(formatarDataHora(instante, SP)).toBe('10/03/2026 10:00');
    expect(formatarDataHora(instante)).toBe('10/03/2026 10:00');
    expect(formatarData(instante, SP)).toBe('10/03/2026');
    expect(formatarHora(instante, SP)).toBe('10:00');
    expect(formatarData(instante)).toBe('10/03/2026');
    expect(formatarHora(instante)).toBe('10:00');
  });

  it.each([
    ['2026-03-10T03:00:00Z', '10/03/2026 00:00'],
    ['2026-03-11T02:30:00Z', '10/03/2026 23:30'],
    ['2026-01-01T02:59:00Z', '31/12/2025 23:59'],
    ['2026-01-05T12:05:00Z', '05/01/2026 09:05'],
  ])('CA-6: %s → %s', (iso, esperado) => {
    expect(formatarDataHora(d(iso), SP)).toBe(esperado);
  });

  it('CA-6: meia-noite local é 00:00, nunca 24:00', () => {
    expect(formatarHora(d('2026-03-10T03:00:00Z'), SP)).toBe('00:00');
  });

  it.each([
    ['2026-03-10T13:00:00Z', 'America/Manaus', '10/03/2026 09:00'],
    ['2026-03-10T13:00:00Z', 'America/Noronha', '10/03/2026 11:00'],
    ['2026-03-10T13:00:00Z', 'UTC', '10/03/2026 13:00'],
    ['2026-01-01T00:00:00Z', 'America/Rio_Branco', '31/12/2025 19:00'],
  ])('CA-7: %s em %s → %s', (iso, fuso, esperado) => {
    expect(formatarDataHora(d(iso), fuso)).toBe(esperado);
  });

  it.each(CASOS_CA8())('CA-8: %s → %s (horário de verão histórico)', (iso, esperado) => {
    expect(formatarDataHora(d(iso), SP)).toBe(esperado);
  });

  it('CA-8: dois instantes distintos com o mesmo rótulo no fim do horário de verão', () => {
    const a = d('2019-02-17T01:00:00Z');
    const b = d('2019-02-17T02:00:00Z');
    expect(a.getTime()).not.toBe(b.getTime());
    expect(formatarDataHora(a, SP)).toBe(formatarDataHora(b, SP));
  });
});

function CASOS_CA8(): [string, string][] {
  return [
    ['2018-11-04T02:59:00Z', '03/11/2018 23:59'],
    ['2018-11-04T03:00:00Z', '04/11/2018 01:00'],
    ['2019-02-17T01:59:00Z', '16/02/2019 23:59'],
    ['2019-02-17T02:00:00Z', '16/02/2019 23:00'],
    ['2019-02-17T01:00:00Z', '16/02/2019 23:00'],
    ['2019-03-10T13:00:00Z', '10/03/2019 10:00'],
    ['2019-01-10T13:00:00Z', '10/01/2019 11:00'],
  ];
}

describe('CA-9: independência do fuso do processo (D-23)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    ['UTC', 0],
    ['America/Fortaleza', 180],
    ['Asia/Tokyo', -540],
  ])('com TZ=%s o resultado é o mesmo', (tz, deslocamentoEsperado) => {
    vi.stubEnv('TZ', tz);
    // Autoverificação: o fuso do processo mudou de fato.
    expect(new Date('2026-03-10T13:00:00Z').getTimezoneOffset()).toBe(deslocamentoEsperado);

    expect(formatarDataHora(d('2026-03-10T13:00:00Z'), SP)).toBe('10/03/2026 10:00');
    expect(formatarDataHora(d('2026-03-10T13:00:00Z'))).toBe('10/03/2026 10:00');
    for (const [iso, esperado] of CASOS_CA8()) {
      expect(formatarDataHora(d(iso), SP)).toBe(esperado);
    }
  });
});

describe('CA-9: entradas inválidas', () => {
  it('Date inválido → RangeError nas quatro funções de data', () => {
    expect(() => formatarData(new Date('x'))).toThrow(RangeError);
    expect(() => formatarHora(new Date(NaN))).toThrow(RangeError);
    expect(() => formatarDataHora(new Date('x'), 'UTC')).toThrow(RangeError);
    expect(() => formatarDeslocamentoUtc(new Date('x'), 'UTC')).toThrow(RangeError);
  });

  it.each([formatarData, formatarHora, formatarDataHora, formatarDeslocamentoUtc])(
    'fuso inexistente ou vazio → RangeError (%o)',
    (fn) => {
      const instante = d('2026-03-10T13:00:00Z');
      expect(() => fn(instante, 'America/Inexistente')).toThrow(RangeError);
      expect(() => fn(instante, 'America/Inexistente')).toThrow(
        'Fuso horário inválido: "America/Inexistente"',
      );
      expect(() => fn(instante, '')).toThrow(RangeError);
    },
  );

  it('o RangeError do fuso inexistente preserva a causa do Intl', () => {
    try {
      formatarData(d('2026-03-10T13:00:00Z'), 'America/Inexistente');
      expect.unreachable();
    } catch (erro) {
      expect((erro as Error).cause).toBeInstanceOf(RangeError);
    }
  });

  it('entrada que não é Date → TypeError (D-15)', () => {
    expect(() => formatarData('2026-03-10T13:00:00Z' as never)).toThrow(TypeError);
    expect(() => formatarDataHora(1773147600000 as never)).toThrow(TypeError);
  });

  it('fuso em caixa diferente é aceito pelo Intl', () => {
    expect(formatarHora(d('2026-03-10T13:00:00Z'), 'america/sao_paulo')).toBe('10:00');
  });

  it('toda saída de formatarDataHora casa com dd/mm/aaaa HH:mm', () => {
    const fusos = ['UTC', SP, 'America/Manaus', 'Asia/Kolkata', 'Pacific/Kiritimati'];
    for (let h = 0; h < 48; h += 1) {
      const instante = new Date(Date.UTC(2026, 0, 1) + h * 37 * 60_000);
      for (const fuso of fusos) {
        expect(formatarDataHora(instante, fuso)).toMatch(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
      }
    }
  });
});

describe('formatarDeslocamentoUtc (D-21)', () => {
  it.each([
    ['2019-02-17T01:00:00Z', SP, 'UTC−02:00'],
    ['2019-02-17T02:00:00Z', SP, 'UTC−03:00'],
    ['2026-03-10T13:00:00Z', 'UTC', 'UTC+00:00'],
    ['2026-03-10T13:00:00Z', 'Asia/Kolkata', 'UTC+05:30'],
  ])('%s em %s → %s', (iso, fuso, esperado) => {
    expect(formatarDeslocamentoUtc(d(iso), fuso)).toBe(esperado);
  });

  it('fuso omitido usa FUSO_PADRAO', () => {
    expect(formatarDeslocamentoUtc(d('2026-03-10T13:00:00Z'))).toBe('UTC−03:00');
  });
});

describe('FUSO_PADRAO (D-14)', () => {
  it('é igual ao @default de salao.fuso no prisma/schema.prisma', () => {
    const schema = readFileSync(
      fileURLToPath(new URL('../../prisma/schema.prisma', import.meta.url)),
      'utf8',
    );
    const casado = /^\s*fuso\s+String\s+@default\("([^"]+)"\)/m.exec(schema);
    expect(casado?.[1]).toBe('America/Sao_Paulo');
    expect(FUSO_PADRAO).toBe(casado?.[1]);
  });
});
