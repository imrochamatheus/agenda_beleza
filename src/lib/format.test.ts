import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  formatarMesAno,
  formatarNota,
  formatarData,
  formatarDataCivil,
  formatarDataHora,
  formatarDeslocamentoUtc,
  formatarDiaDaSemana,
  formatarDiaDaSemanaCurto,
  formatarDiaEMesCurtos,
  formatarFaixaDeMinutos,
  formatarLista,
  formatarHora,
  formatarInteiro,
  formatarDuracao,
  formatarMoeda,
  formatarMinutosDoDia,
  formatarMoedaSemSimbolo,
  formatarCep,
  formatarPeriodoBloqueio,
  formatarTelefone,
  mascararTelefone,
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

describe('formatarMoedaSemSimbolo (D-014 §3.4)', () => {
  it.each([
    [0, '0,00'],
    [10, '0,10'],
    [8000, '80,00'],
    [123456, '1.234,56'],
    [9999999, '99.999,99'],
  ])('%d → %s, igual a formatarMoeda sem "R$ "', (centavos, esperado) => {
    expect(formatarMoedaSemSimbolo(centavos)).toBe(esperado);
    expect(formatarMoeda(centavos)).toBe(`R$${NBSP}${esperado}`);
  });

  it('as mesmas recusas de formatarMoeda', () => {
    expect(() => formatarMoedaSemSimbolo(-1)).toThrow(RangeError);
    expect(() => formatarMoedaSemSimbolo(1.5)).toThrow(RangeError);
    expect(() => formatarMoedaSemSimbolo('80' as never)).toThrow(TypeError);
  });
});

describe('formatarDuracao (D-014 D-7)', () => {
  it.each([
    [5, '5 min'],
    [45, '45 min'],
    [60, '1 h'],
    [90, '1 h 30 min'],
    [125, '2 h 5 min'],
    [720, '12 h'],
  ])('%d → %s', (minutos, esperado) => {
    expect(formatarDuracao(minutos)).toBe(esperado);
  });

  it.each([0, -5, 1.5, NaN, Infinity])('%d → RangeError', (minutos) => {
    expect(() => formatarDuracao(minutos)).toThrow(RangeError);
  });

  it('texto → TypeError', () => {
    expect(() => formatarDuracao('45' as never)).toThrow(TypeError);
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

describe('formatarMinutosDoDia (D-015 CA-20)', () => {
  it('0 → 00:00, 5 → 00:05, 545 → 09:05, 1435 → 23:55, 1440 → 24:00', () => {
    expect(formatarMinutosDoDia(0)).toBe('00:00');
    expect(formatarMinutosDoDia(5)).toBe('00:05');
    expect(formatarMinutosDoDia(545)).toBe('09:05');
    expect(formatarMinutosDoDia(1435)).toBe('23:55');
    expect(formatarMinutosDoDia(1440)).toBe('24:00');
  });

  it('fora de 0..1440, não inteiro ou NaN → RangeError; texto → TypeError', () => {
    for (const v of [-5, -1, 1441, 1445, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => formatarMinutosDoDia(v)).toThrow(RangeError);
    }
    expect(() => formatarMinutosDoDia('540' as unknown as number)).toThrow(TypeError);
    expect(() => formatarMinutosDoDia(undefined as unknown as number)).toThrow(TypeError);
  });
});

describe('formatarFaixaDeMinutos (D-015 §3.4)', () => {
  it('(720, 780) → 12:00–13:00 com meia-risca U+2013; (1320, 1440) → 22:00–24:00', () => {
    expect(formatarFaixaDeMinutos(720, 780)).toBe('12:00\u201313:00');
    expect(formatarFaixaDeMinutos(1320, 1440)).toBe('22:00–24:00');
    expect(formatarFaixaDeMinutos(0, 5)).toBe('00:00–00:05');
  });

  it('início ≥ fim ou ponta inválida → RangeError', () => {
    expect(() => formatarFaixaDeMinutos(600, 600)).toThrow(RangeError);
    expect(() => formatarFaixaDeMinutos(1320, 120)).toThrow(RangeError);
    expect(() => formatarFaixaDeMinutos(-5, 60)).toThrow(RangeError);
    expect(() => formatarFaixaDeMinutos(0, 1445)).toThrow(RangeError);
    expect(() => formatarFaixaDeMinutos('0' as unknown as number, 60)).toThrow(TypeError);
  });
});

describe('formatarDiaDaSemana (D-015 RN-15)', () => {
  it('0 = domingo … 6 = sábado', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(formatarDiaDaSemana)).toEqual([
      'Domingo',
      'Segunda-feira',
      'Terça-feira',
      'Quarta-feira',
      'Quinta-feira',
      'Sexta-feira',
      'Sábado',
    ]);
  });

  it('fora de 0..6 inteiro → RangeError', () => {
    for (const v of [7, -1, 1.5, Number.NaN, '1' as unknown as number]) {
      expect(() => formatarDiaDaSemana(v)).toThrow(RangeError);
    }
  });
});

describe('formatarPeriodoBloqueio (D-016 CA-23, CA-3, CA-5, R-2)', () => {
  it('dia inteiro de uma única data → "dd/mm/aaaa (dia inteiro)" (CA-3)', () => {
    expect(formatarPeriodoBloqueio(d('2026-12-25T03:00:00Z'), d('2026-12-26T03:00:00Z'), SP, true)).toBe('25/12/2026 (dia inteiro)');
  });

  it('vários dias inteiros → "primeira a última" (datas inclusivas)', () => {
    expect(formatarPeriodoBloqueio(d('2026-12-24T03:00:00Z'), d('2026-12-27T03:00:00Z'), SP, true)).toBe('24/12/2026 a 26/12/2026');
  });

  it('com horário atravessando a meia-noite → data e hora nas duas pontas (CA-5)', () => {
    expect(formatarPeriodoBloqueio(d('2026-12-26T01:00:00Z'), d('2026-12-26T05:00:00Z'), SP, false)).toBe('25/12/2026 22:00 a 26/12/2026 02:00');
  });

  it('dias de 23 h e de 25 h em São Paulo (horário de verão histórico, R-2)', () => {
    expect(formatarPeriodoBloqueio(d('2018-11-04T03:00:00Z'), d('2018-11-05T02:00:00Z'), SP, true)).toBe('04/11/2018 (dia inteiro)');
    expect(formatarPeriodoBloqueio(d('2018-02-17T02:00:00Z'), d('2018-02-18T03:00:00Z'), SP, true)).toBe('17/02/2018 (dia inteiro)');
    expect(formatarPeriodoBloqueio(d('2018-02-17T02:00:00Z'), d('2018-11-05T02:00:00Z'), SP, true)).toBe('17/02/2018 a 04/11/2018');
  });

  it('o mesmo instante é exibido no fuso pedido (Manaus, CA-17)', () => {
    expect(formatarPeriodoBloqueio(d('2026-12-25T17:00:00Z'), d('2026-12-25T19:00:00Z'), 'America/Manaus', false)).toBe(
      '25/12/2026 13:00 a 25/12/2026 15:00',
    );
  });

  it('fim <= início, instante inválido ou fuso inválido → erro', () => {
    const a = d('2026-12-25T03:00:00Z');
    expect(() => formatarPeriodoBloqueio(a, a, SP, false)).toThrow(RangeError);
    expect(() => formatarPeriodoBloqueio(a, d('2026-12-24T03:00:00Z'), SP, true)).toThrow(RangeError);
    expect(() => formatarPeriodoBloqueio(new Date('x'), a, SP, false)).toThrow(RangeError);
    expect(() => formatarPeriodoBloqueio(a, d('2026-12-26T03:00:00Z'), '', true)).toThrow(RangeError);
    expect(() => formatarPeriodoBloqueio(a, d('2026-12-26T03:00:00Z'), 'Foo/Bar', true)).toThrow(RangeError);
  });
});

describe('formatarTelefone e formatarCep (D-020 CA-18)', () => {
  it('fixo e celular gravados em E.164', () => {
    expect(formatarTelefone('+551134567890')).toBe('(11) 3456-7890');
    expect(formatarTelefone('+5511987654321')).toBe('(11) 98765-4321');
    expect(formatarTelefone('+559932345678')).toBe('(99) 3234-5678');
  });

  it.each(['11987654321', '+1123456789', '+550034567890', '+5511887654321', '+551194567890', '+55119876543210', '', 42 as unknown as string])(
    'telefone fora do formato gravado (%s) → RangeError',
    (v) => {
      expect(() => formatarTelefone(v)).toThrow(RangeError);
    },
  );

  it('CEP com 8 dígitos', () => {
    expect(formatarCep('01310100')).toBe('01310-100');
  });

  it.each(['01310-100', '1310100', '013101000', 'abcdefgh', '', null as unknown as string])('CEP fora do formato (%s) → RangeError', (v) => {
    expect(() => formatarCep(v)).toThrow(RangeError);
  });
});

describe('formatarInteiro (D-020)', () => {
  it('milhar com ponto', () => {
    expect(formatarInteiro(0)).toBe('0');
    expect(formatarInteiro(999)).toBe('999');
    expect(formatarInteiro(1000)).toBe('1.000');
    expect(formatarInteiro(1234567)).toBe('1.234.567');
  });

  it.each([-1, 1.5, Number.NaN, '1' as unknown as number])('inválido (%s) → RangeError', (v) => {
    expect(() => formatarInteiro(v)).toThrow(RangeError);
  });
});

describe('formatarDataCivil (D-023)', () => {
  it('reordena a data de calendário sem depender do fuso', () => {
    expect(formatarDataCivil('2026-11-21')).toBe('21/11/2026');
    expect(formatarDataCivil('2024-02-29')).toBe('29/02/2024');
  });

  it.each(['2026-02-30', '2026-13-01', '21/11/2026', '', '2026-1-1'])('%s → RangeError', (v) => {
    expect(() => formatarDataCivil(v)).toThrow(RangeError);
  });

  it('entrada que não é texto → RangeError', () => {
    expect(() => formatarDataCivil(undefined as unknown as string)).toThrow(RangeError);
  });
});

describe('formatarLista (D-024)', () => {
  it.each([
    [[], ''],
    [['Corte'], 'Corte'],
    [['Corte', 'Barba'], 'Corte e Barba'],
    [['Corte', 'Barba', 'Hidratação'], 'Corte, Barba e Hidratação'],
    [['A', 'B', 'C', 'D'], 'A, B, C e D'],
  ])('%j → %s', (nomes, esperado) => {
    expect(formatarLista(nomes)).toBe(esperado);
  });

  it('texto fora da lista → TypeError', () => {
    expect(() => formatarLista([1] as never)).toThrow(TypeError);
    expect(() => formatarLista('A' as never)).toThrow(TypeError);
  });
});

describe('formatarNota (D-032)', () => {
  it.each([
    [4.3, '4,3'],
    [5, '5,0'],
    [1, '1,0'],
    [3.5, '3,5'],
  ])('%s → %s', (n, esperado) => {
    expect(formatarNota(n)).toBe(esperado);
  });

  it.each([[0], [5.1], [0.9], [NaN], [Infinity], ['4' as never]])('fora de 1..5 ou não numérico (%s) → RangeError', (n) => {
    expect(() => formatarNota(n)).toThrow(RangeError);
  });
});

describe('formatarMesAno (D-032)', () => {
  it('mês por extenso e ano no fuso do salão', () => {
    expect(formatarMesAno(new Date('2026-11-22T12:00:00Z'), 'America/Sao_Paulo')).toBe('novembro de 2026');
    expect(formatarMesAno(new Date('2026-03-15T12:00:00Z'), 'America/Sao_Paulo')).toBe('março de 2026');
  });

  it('a virada do mês depende do fuso, não do processo', () => {
    const instante = new Date('2026-12-01T01:30:00Z');
    expect(formatarMesAno(instante, 'UTC')).toBe('dezembro de 2026');
    expect(formatarMesAno(instante, 'America/Sao_Paulo')).toBe('novembro de 2026');
    expect(formatarMesAno(new Date('2027-01-01T02:00:00Z'), 'America/Sao_Paulo')).toBe('dezembro de 2026');
  });

  it('fuso inválido → RangeError; nunca traz o dia', () => {
    expect(() => formatarMesAno(new Date(), 'Nao/Existe')).toThrow(RangeError);
    expect(formatarMesAno(new Date('2026-11-22T12:00:00Z'), 'UTC')).not.toMatch(/22/);
  });
});

describe('mascararTelefone (D-045 RN-2, CA-5)', () => {
  it('celular: DDD, "9" e os 4 últimos dígitos', () => {
    expect(mascararTelefone('+5571987651234')).toBe('+55 (71) 9****-1234');
  });

  it('fixo de 8 dígitos: sem o 9', () => {
    expect(mascararTelefone('+557133451234')).toBe('+55 (71) ****-1234');
  });

  it('nunca expõe os dígitos do meio', () => {
    const m = mascararTelefone('+5511987654321');
    expect(m).toBe('+55 (11) 9****-4321');
    expect(m).not.toContain('8765');
  });

  it.each([null, undefined, 42, '', 'abc', '+14155550100', '+5500987654321', '+55719876512', '71987651234', {}])(
    'valor inválido %j → "—" sem lançar',
    (v) => {
      expect(mascararTelefone(v)).toBe('—');
    },
  );
});

describe('formatarDiaDaSemanaCurto (D-051)', () => {
  it('0 = Dom … 6 = Sáb', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(formatarDiaDaSemanaCurto)).toEqual(['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']);
  });

  it('fora de 0..6 inteiro → RangeError', () => {
    for (const v of [7, -1, 1.5, Number.NaN, '1' as unknown as number]) {
      expect(() => formatarDiaDaSemanaCurto(v)).toThrow(RangeError);
    }
  });
});

describe('formatarDiaEMesCurtos (D-051)', () => {
  it('dia sem zero à esquerda e os 12 meses curtos, sem depender do fuso', () => {
    const meses = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
    meses.forEach((mes, i) => {
      expect(formatarDiaEMesCurtos(`2026-${String(i + 1).padStart(2, '0')}-01`)).toEqual({ dia: '1', mes });
    });
    expect(formatarDiaEMesCurtos('2026-11-29')).toEqual({ dia: '29', mes: 'nov' });
    expect(formatarDiaEMesCurtos('2024-02-29')).toEqual({ dia: '29', mes: 'fev' });
    expect(formatarDiaEMesCurtos('2026-12-10')).toEqual({ dia: '10', mes: 'dez' });
  });

  it.each(['2026-02-30', 'x', '2026-13-01', '', '01/12/2026'])('%s → RangeError', (v) => {
    expect(() => formatarDiaEMesCurtos(v)).toThrow(RangeError);
  });
});
