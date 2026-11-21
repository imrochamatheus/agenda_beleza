import { describe, expect, it } from 'vitest';

import {
  TERMOS_EXATOS,
  TERMOS_POR_SUBSTRING,
  chaveEhProibida,
  normalizarChave,
  rejeitarSegredos,
  validarJson,
} from './sanitizar';
import { ErroAuditoriaEntrada, ErroAuditoriaSegredo, MAX_BYTES } from './tipos';

describe('chaves proibidas (CA-5)', () => {
  it('normaliza minúsculas, sem acento e só [a-z0-9]', () => {
    expect(normalizarChave('Cartão_Número-1')).toBe('cartaonumero1');
  });

  it.each(TERMOS_POR_SUBSTRING.map((t) => [t]))('substring: %s (e variações)', (t) => {
    expect(chaveEhProibida(t)).toBe(true);
    expect(chaveEhProibida(`meu_${t.toUpperCase()}_x`)).toBe(true);
  });

  it.each(TERMOS_EXATOS.map((t) => [t]))('exata: %s', (t) => {
    expect(chaveEhProibida(t)).toBe(true);
    expect(chaveEhProibida(t.toUpperCase())).toBe(true);
  });

  it('pega os exemplos da especificação', () => {
    for (const k of ['senha', 'totpSecret', 'tokenHash', 'Authorization', 'otp_code', 'Cartão']) {
      expect(chaveEhProibida(k)).toBe(true);
    }
  });

  it.each(['panorama', 'capital', 'hotpot', 'footprint', 'nome', 'slug', 'ocultaEm', 'motivo'])(
    'chave legítima passa: %s',
    (k) => {
      expect(chaveEhProibida(k)).toBe(false);
      expect(() => rejeitarSegredos({ [k]: 1 }, 'depois')).not.toThrow();
    },
  );

  it('varre objetos e arrays e informa só o caminho, nunca o valor', () => {
    const valor = 'VALOR-SECRETO-123';
    for (const [entrada, caminho] of [
      [{ senha: valor }, 'depois.senha'],
      [{ a: { b: [1, { totpSecret: valor }] } }, 'depois.a.b[1].totpSecret'],
      [{ a: [{ x: 1 }, { y: 1 }, { Authorization: valor }] }, 'depois.a[2].Authorization'],
    ] as const) {
      let erro: unknown;
      try {
        rejeitarSegredos(entrada, 'depois');
      } catch (e) {
        erro = e;
      }
      expect(erro).toBeInstanceOf(ErroAuditoriaSegredo);
      expect((erro as ErroAuditoriaSegredo).caminho).toBe(caminho);
      expect((erro as Error).message).toContain(caminho);
      expect((erro as Error).message).not.toContain(valor);
    }
  });
});

describe('validarJson (CA-7)', () => {
  it('aceita JSON puro, inclusive objeto sem protótipo', () => {
    const semProto = Object.assign(Object.create(null), { a: 1 });
    expect(() => validarJson({ a: [1, 'x', true, null, { b: 2 }], c: semProto }, 'depois')).not.toThrow();
  });

  it.each([
    ['undefined', { a: undefined }],
    ['Date', { a: new Date() }],
    ['bigint', { a: 1n }],
    ['função', { a: () => 1 }],
    ['NaN', { a: NaN }],
    ['Infinity', { a: Infinity }],
    ['símbolo', { a: Symbol('x') }],
    ['instância de classe', { a: new Map() }],
  ])('recusa %s', (_n, v) => {
    expect(() => validarJson(v, 'depois')).toThrow(ErroAuditoriaEntrada);
  });

  it('recusa ciclo, mas aceita o mesmo objeto repetido sem ciclo', () => {
    const a: Record<string, unknown> = {};
    a.a = a;
    expect(() => validarJson(a, 'antes')).toThrow('referência circular');
    const comum = { x: 1 };
    expect(() => validarJson({ p: comum, q: comum }, 'antes')).not.toThrow();
  });

  it('profundidade: 6 níveis passam, 7 não', () => {
    const nivel = (n: number): unknown => (n === 1 ? { f: 1 } : { f: nivel(n - 1) });
    expect(() => validarJson(nivel(6), 'depois')).not.toThrow();
    expect(() => validarJson(nivel(7), 'depois')).toThrow('profundidade');
  });

  it('tamanho em bytes UTF-8: no limite passa, acima recusa (sem truncar)', () => {
    const base = JSON.stringify({ t: '' }).length;
    expect(() => validarJson({ t: 'a'.repeat(MAX_BYTES - base) }, 'depois')).not.toThrow();
    expect(() => validarJson({ t: 'a'.repeat(MAX_BYTES - base + 1) }, 'depois')).toThrow('bytes');
    // 'é' ocupa 2 bytes: metade dos caracteres já estoura.
    expect(() => validarJson({ t: 'é'.repeat((MAX_BYTES - base) / 2 + 1) }, 'depois')).toThrow('bytes');
  });
});
