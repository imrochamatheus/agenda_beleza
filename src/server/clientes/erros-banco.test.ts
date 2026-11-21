import { describe, expect, it } from 'vitest';

import { RESTRICAO_TELEFONE_UNICO, ehViolacaoDeTelefoneUnico } from './erros-banco';

// D-022 T-3 (R-2): só a violação de cliente_salao_id_telefone_e164_key é reconhecida.

const P2010_REAL = {
  code: 'P2010',
  meta: {
    driverAdapterError: {
      name: 'DriverAdapterError',
      cause: {
        originalCode: '23505',
        originalMessage: `duplicate key value violates unique constraint "${RESTRICAO_TELEFONE_UNICO}"`,
        kind: 'UniqueConstraintViolation',
        constraint: { index: RESTRICAO_TELEFONE_UNICO },
        table: 'cliente',
      },
    },
  },
  message: 'Invalid `prisma.$queryRaw()` invocation',
};

describe('ehViolacaoDeTelefoneUnico', () => {
  it('P2010 do adaptador (forma observada no PostgreSQL real)', () => {
    expect(ehViolacaoDeTelefoneUnico(P2010_REAL)).toBe(true);
  });

  it('P2010 com meta.code 23505 e a restrição na mensagem', () => {
    expect(ehViolacaoDeTelefoneUnico({ code: 'P2010', meta: { code: '23505' }, message: `violates unique constraint "${RESTRICAO_TELEFONE_UNICO}"` })).toBe(true);
  });

  it('P2002 com target em telefone_e164 (array ou texto) ou com a restrição', () => {
    expect(ehViolacaoDeTelefoneUnico({ code: 'P2002', meta: { target: ['salao_id', 'telefone_e164'] } })).toBe(true);
    expect(ehViolacaoDeTelefoneUnico({ code: 'P2002', meta: { target: 'cliente_salao_id_telefone_e164_key' } })).toBe(true);
    expect(ehViolacaoDeTelefoneUnico({ code: 'P2002', meta: {}, message: RESTRICAO_TELEFONE_UNICO })).toBe(true);
  });

  it('outras restrições e outros erros não são reconhecidos', () => {
    expect(ehViolacaoDeTelefoneUnico({ code: 'P2002', meta: { target: ['salao_id', 'slug'] } })).toBe(false);
    expect(ehViolacaoDeTelefoneUnico({ code: 'P2010', meta: { code: '23505' }, message: 'outra_restricao_key' })).toBe(false);
    expect(ehViolacaoDeTelefoneUnico({ code: 'P2010', meta: { code: '40P01' }, message: RESTRICAO_TELEFONE_UNICO })).toBe(false);
    expect(ehViolacaoDeTelefoneUnico({ code: 'P2025' })).toBe(false);
    expect(ehViolacaoDeTelefoneUnico(new Error(RESTRICAO_TELEFONE_UNICO))).toBe(false);
  });

  it('valores que não são objeto e meta circular não lançam', () => {
    for (const v of [null, undefined, 'P2002', 7]) expect(ehViolacaoDeTelefoneUnico(v)).toBe(false);
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(ehViolacaoDeTelefoneUnico({ code: 'P2002', meta: circular })).toBe(false);
  });
});
