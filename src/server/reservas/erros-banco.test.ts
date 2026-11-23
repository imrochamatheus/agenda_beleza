import { describe, expect, it } from 'vitest';

import { RESTRICAO_SOBREPOSICAO, ehConflitoDeSobreposicao } from './erros-banco';

// CA-18 (D-025) e D-050 §3.3: só o 23P01 COM o nome reserva_item_sem_sobreposicao é reconhecido. A fixture REAL_P2010 é
// a forma capturada de um INSERT bruto contra o PostgreSQL com Prisma 7 (ver erros-banco.ts).

const MENSAGEM = `conflicting key value violates exclusion constraint "${RESTRICAO_SOBREPOSICAO}"`;

const REAL_P2010 = {
  name: 'PrismaClientKnownRequestError',
  code: 'P2010',
  clientVersion: '7',
  meta: {
    driverAdapterError: {
      name: 'DriverAdapterError',
      cause: {
        originalCode: '23P01',
        originalMessage: MENSAGEM,
        kind: 'postgres',
        code: '23P01',
        severity: 'ERROR',
        message: MENSAGEM,
        detail: 'Key (profissional_id, tstzrange(...)) conflicts with existing key (...).',
      },
    },
  },
  message: `\nInvalid \`prisma.$queryRaw()\` invocation:\n\nRaw query failed. Code: \`23P01\`. Message: \`${MENSAGEM}\``,
};

function comCausa(cause: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return { code: 'P2010', meta: { driverAdapterError: { cause } }, message: 'x', ...extra };
}

describe('ehConflitoDeSobreposicao', () => {
  it('P2010 real do adaptador', () => {
    expect(ehConflitoDeSobreposicao(REAL_P2010)).toBe(true);
  });

  it('erro cru do pg com code e constraint', () => {
    expect(ehConflitoDeSobreposicao({ code: '23P01', constraint: RESTRICAO_SOBREPOSICAO })).toBe(true);
  });

  it('P2010 com o nome em causa.constraint ou só na mensagem da causa', () => {
    expect(ehConflitoDeSobreposicao(comCausa({ code: '23P01', constraint: RESTRICAO_SOBREPOSICAO }))).toBe(true);
    expect(ehConflitoDeSobreposicao(comCausa({ originalCode: '23P01', message: MENSAGEM }))).toBe(true);
  });

  it('P2010 com meta.code e o nome na mensagem do erro', () => {
    expect(ehConflitoDeSobreposicao({ code: 'P2010', meta: { code: '23P01' }, message: MENSAGEM })).toBe(true);
  });

  it('23P01 de OUTRA restrição não é reconhecido', () => {
    expect(ehConflitoDeSobreposicao({ code: '23P01', constraint: 'outra_exclusao' })).toBe(false);
    expect(
      ehConflitoDeSobreposicao(comCausa({ originalCode: '23P01', originalMessage: 'violates exclusion constraint "outra_exclusao"' })),
    ).toBe(false);
  });

  it('D-050: o nome ANTIGO reserva_sem_sobreposicao não é mais reconhecido', () => {
    const antigo = 'conflicting key value violates exclusion constraint "reserva_sem_sobreposicao"';
    expect(RESTRICAO_SOBREPOSICAO).toBe('reserva_item_sem_sobreposicao');
    expect(ehConflitoDeSobreposicao({ code: '23P01', constraint: 'reserva_sem_sobreposicao' })).toBe(false);
    expect(ehConflitoDeSobreposicao(comCausa({ originalCode: '23P01', originalMessage: antigo, message: antigo }))).toBe(false);
  });

  it('D-050: reserva_item_mesma_reserva_sem_sobreposicao NUNCA é reconhecida (indica falha de conferirItens)', () => {
    const nome = 'reserva_item_mesma_reserva_sem_sobreposicao';
    const msg = `conflicting key value violates exclusion constraint "${nome}"`;
    expect(ehConflitoDeSobreposicao({ code: '23P01', constraint: nome })).toBe(false);
    expect(ehConflitoDeSobreposicao(comCausa({ originalCode: '23P01', code: '23P01', originalMessage: msg, message: msg }))).toBe(false);
    expect(ehConflitoDeSobreposicao({ code: 'P2010', meta: { code: '23P01' }, message: msg })).toBe(false);
  });

  it('23P01 sem nome (nenhuma evidência da restrição) não é reconhecido', () => {
    expect(ehConflitoDeSobreposicao({ code: '23P01' })).toBe(false);
    expect(ehConflitoDeSobreposicao(comCausa({ originalCode: '23P01' }))).toBe(false);
  });

  it('o nome da restrição com outro SQLSTATE não é reconhecido', () => {
    expect(ehConflitoDeSobreposicao({ code: '23505', constraint: RESTRICAO_SOBREPOSICAO })).toBe(false);
    expect(ehConflitoDeSobreposicao(comCausa({ originalCode: '23505', originalMessage: MENSAGEM }))).toBe(false);
  });

  it('o nome solto no texto, sem aspas, não basta', () => {
    expect(ehConflitoDeSobreposicao(comCausa({ originalCode: '23P01', originalMessage: `falha em ${RESTRICAO_SOBREPOSICAO}` }))).toBe(false);
  });

  it('P2002, 23514 e erros comuns não são reconhecidos', () => {
    expect(ehConflitoDeSobreposicao({ code: 'P2002', meta: { target: ['salao_id', 'chave_requisicao'] } })).toBe(false);
    expect(ehConflitoDeSobreposicao({ code: '23514', constraint: 'reserva_ordem_chk' })).toBe(false);
    expect(ehConflitoDeSobreposicao(new Error(MENSAGEM))).toBe(false);
  });

  it('valores que não são objeto nunca lançam', () => {
    for (const v of [null, undefined, 'P2010', 42, true, []]) {
      expect(ehConflitoDeSobreposicao(v)).toBe(false);
    }
  });
});
