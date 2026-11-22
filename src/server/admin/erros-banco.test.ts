import { describe, expect, it } from 'vitest';

import { RESTRICAO_EMAIL_UNICO, ehViolacaoDeEmailUnico } from './erros-banco';

const P2010 = (restricao: string, sqlstate = '23505') => ({
  code: 'P2010',
  meta: {
    driverAdapterError: {
      cause: { originalCode: sqlstate, originalMessage: `duplicate key value violates unique constraint "${restricao}"`, constraint: { index: restricao } },
    },
  },
  message: 'Invalid `prisma.$executeRaw()` invocation',
});

describe('ehViolacaoDeEmailUnico', () => {
  it('reconhece só usuario_email_key com 23505', () => {
    expect(ehViolacaoDeEmailUnico(P2010(RESTRICAO_EMAIL_UNICO))).toBe(true);
    expect(ehViolacaoDeEmailUnico({ code: 'P2002', meta: { target: ['email'] } })).toBe(true);
    expect(ehViolacaoDeEmailUnico({ code: '23505', constraint: RESTRICAO_EMAIL_UNICO })).toBe(true);
  });
  it('não confunde outra restrição, outro SQLSTATE nem valores que não são erro', () => {
    expect(ehViolacaoDeEmailUnico(P2010('cliente_salao_id_telefone_e164_key'))).toBe(false);
    expect(ehViolacaoDeEmailUnico(P2010(RESTRICAO_EMAIL_UNICO, '23P01'))).toBe(false);
    expect(ehViolacaoDeEmailUnico({ code: 'P2002', meta: { target: ['slug'] } })).toBe(false);
    for (const v of [null, undefined, 'x', 42, new Error('duplicate')]) expect(ehViolacaoDeEmailUnico(v)).toBe(false);
  });
});
