import { describe, expect, it } from 'vitest';

import { DIAS_TESTE, PRECO_MENSAL_CENTAVOS } from '@/config/plano';

import {
  ESTRATEGIA_CRIACAO,
  extrairProximaCobranca,
  lerIdCriado,
  lerInitPoint,
  mapearPagamento,
  mapearPreapproval,
  montarCorpoAdiamento,
  montarCorpoCancelamento,
  montarCorpoCriacao,
  montarManifesto,
  tsParaMs,
} from './mapeamento';
import { ErroProvedor } from './port';

const SALAO = '6f1c2c0e-1b2a-4c3d-8e4f-5a6b7c8d9e0f';
const ENTRADA = {
  planoId: 'plano1',
  emailPagador: 'g@exemplo.com',
  salaoId: SALAO,
  urlRetorno: 'https://a.com.br/retorno',
};

const PRE = (o: Record<string, unknown> = {}) => ({
  id: 'abc123',
  status: 'authorized',
  external_reference: SALAO,
  init_point: 'https://www.mercadopago.com.br/subscriptions/checkout?preapproval_id=abc123',
  date_created: '2026-11-01T10:00:00.000-03:00',
  last_modified: '2026-11-02T10:00:00.000-03:00',
  next_payment_date: '2026-12-01T10:00:00.000-03:00',
  auto_recurring: { transaction_amount: '79.00', campo_novo: 1 },
  campo_desconhecido: true,
  ...o,
});

describe('montarCorpoCriacao (CA-1)', () => {
  it('a estratégia padrão é com_plano', () => {
    expect(ESTRATEGIA_CRIACAO).toBe('com_plano');
  });

  it('com_plano envia o plano, sem auto_recurring nem cartão', () => {
    const c = montarCorpoCriacao('com_plano', ENTRADA);
    expect(c).toEqual({
      preapproval_plan_id: 'plano1',
      reason: 'Assinatura Agenda Beleza',
      external_reference: SALAO,
      payer_email: 'g@exemplo.com',
      back_url: 'https://a.com.br/retorno',
      status: 'pending',
    });
    expect(JSON.stringify(c)).not.toContain('card');
  });

  it('sem_plano usa preço e teste de src/config/plano.ts', () => {
    const c = montarCorpoCriacao('sem_plano', { ...ENTRADA, urlNotificacao: 'https://a.com.br/api/webhooks/mercadopago' });
    expect(c).not.toHaveProperty('preapproval_plan_id');
    expect(c.notification_url).toBe('https://a.com.br/api/webhooks/mercadopago');
    expect(c.auto_recurring).toEqual({
      frequency: 1,
      frequency_type: 'months',
      transaction_amount: PRECO_MENSAL_CENTAVOS / 100,
      currency_id: 'BRL',
      free_trial: { frequency: DIAS_TESTE, frequency_type: 'days' },
    });
    expect(c.external_reference).toBe(SALAO);
  });

  it('corpos de adiamento e cancelamento', () => {
    expect(montarCorpoAdiamento(new Date('2027-01-10T12:00:00Z'))).toEqual({ next_payment_date: '2027-01-10T12:00:00.000Z' });
    expect(montarCorpoCancelamento()).toEqual({ status: 'cancelled' });
  });
});

describe('manifesto e ts', () => {
  it('monta o manifesto na ordem e omite pares ausentes', () => {
    expect(montarManifesto({ dataId: '1', requestId: 'r', ts: '9' })).toBe('id:1;request-id:r;ts:9;');
    expect(montarManifesto({ requestId: 'r', ts: '9' })).toBe('request-id:r;ts:9;');
    expect(montarManifesto({ dataId: '1' })).toBe('id:1;');
    expect(montarManifesto({})).toBe('');
  });

  it('ts de 10 dígitos é segundos e de 13 é milissegundos', () => {
    expect(tsParaMs('1781009491')).toBe(1781009491000);
    expect(tsParaMs('1742505638683')).toBe(1742505638683);
  });
});

describe('mapearPreapproval (CA-1, CA-1b)', () => {
  it('mapeia estado, valor em centavos, datas UTC e salaoId; ignora campos desconhecidos', () => {
    expect(mapearPreapproval(PRE())).toEqual({
      id: 'abc123',
      salaoId: SALAO,
      estado: 'autorizada',
      valorCentavos: 7900,
      autorizadaEm: new Date('2026-11-01T13:00:00.000Z'),
      proximaCobrancaEm: new Date('2026-12-01T13:00:00.000Z'),
      canceladaEm: null,
    });
  });

  it('pending e cancelled; valor numérico; datas ausentes viram null', () => {
    const p = mapearPreapproval(
      PRE({ status: 'pending', auto_recurring: { transaction_amount: 24.5 }, next_payment_date: null, date_created: undefined }),
    );
    expect(p).toMatchObject({ estado: 'pendente', valorCentavos: 2450, autorizadaEm: null, proximaCobrancaEm: null });
    const c = mapearPreapproval(PRE({ status: 'cancelled' }));
    expect(c.estado).toBe('cancelada');
    expect(c.canceladaEm).toEqual(new Date('2026-11-02T13:00:00.000Z'));
    expect(c.autorizadaEm).toBeNull();
  });

  it('arredonda o valor evitando erro de ponto flutuante (19.99)', () => {
    expect(mapearPreapproval(PRE({ auto_recurring: { transaction_amount: '19.99' } })).valorCentavos).toBe(1999);
  });

  it.each([
    ['status paused', PRE({ status: 'paused' })],
    ['status desconhecido', PRE({ status: 'finished' })],
    ['external_reference não UUID', PRE({ external_reference: 'abc' })],
    ['sem id', PRE({ id: undefined })],
    ['sem auto_recurring', PRE({ auto_recurring: undefined })],
    ['valor inválido', PRE({ auto_recurring: { transaction_amount: 'abc' } })],
    ['valor negativo', PRE({ auto_recurring: { transaction_amount: -1 } })],
    ['data inválida', PRE({ next_payment_date: 'ontem' })],
    ['não objeto', 'texto'],
    ['null', null],
  ])('ErroProvedor: %s', (_n, json) => {
    expect(() => mapearPreapproval(json)).toThrow(ErroProvedor);
  });

  it('extrairProximaCobranca devolve a data da resposta', () => {
    expect(extrairProximaCobranca(PRE())).toEqual(new Date('2026-12-01T13:00:00.000Z'));
  });
});

describe('lerInitPoint e lerIdCriado', () => {
  it('só aceita https', () => {
    expect(lerInitPoint({ init_point: 'https://x.com/y' })).toBe('https://x.com/y');
    expect(lerInitPoint({ init_point: 'http://x.com/y' })).toBeNull();
    expect(lerInitPoint({ init_point: 'nao-url' })).toBeNull();
    expect(lerInitPoint({ init_point: 3 })).toBeNull();
    expect(lerInitPoint({})).toBeNull();
    expect(lerInitPoint(null)).toBeNull();
  });

  it('id criado exige texto não vazio', () => {
    expect(lerIdCriado({ id: 'a1' })).toBe('a1');
    expect(() => lerIdCriado({ id: '' })).toThrow(ErroProvedor);
    expect(() => lerIdCriado({})).toThrow(ErroProvedor);
  });
});

describe('mapearPagamento (CA-1b)', () => {
  const PAG = (o: Record<string, unknown> = {}) => ({
    id: 987,
    preapproval_id: 'abc123',
    status: 'processed',
    transaction_amount: '79.00',
    debit_date: '2026-12-01T10:00:00.000-03:00',
    payment: { id: 1, status: 'approved' },
    ...o,
  });

  it('processed + approved é aprovado', () => {
    expect(mapearPagamento(PAG())).toEqual({
      id: '987',
      assinaturaId: 'abc123',
      status: 'aprovado',
      valorCentavos: 7900,
      ocorridoEm: new Date('2026-12-01T13:00:00.000Z'),
    });
  });

  it.each([
    ['payment rejected', PAG({ payment: { status: 'rejected' } })],
    ['recycling', PAG({ status: 'recycling', payment: undefined })],
    ['cancelled', PAG({ status: 'cancelled', payment: null })],
  ])('%s é recusado', (_n, json) => {
    expect(mapearPagamento(json).status).toBe('recusado');
  });

  it.each([
    ['scheduled', PAG({ status: 'scheduled', payment: undefined })],
    ['processed sem payment', PAG({ payment: undefined })],
    ['processed com payment pendente', PAG({ payment: { status: 'pending' } })],
    ['desconhecido', PAG({ status: 'xyz' })],
    ['sem data alguma', PAG({ debit_date: undefined })],
    ['sem preapproval_id', PAG({ preapproval_id: undefined })],
  ])('%s é ErroProvedor', (_n, json) => {
    expect(() => mapearPagamento(json)).toThrow(ErroProvedor);
  });

  it('usa last_modified ou date_created quando falta debit_date', () => {
    expect(mapearPagamento(PAG({ debit_date: undefined, last_modified: '2026-12-02T00:00:00Z' })).ocorridoEm).toEqual(
      new Date('2026-12-02T00:00:00Z'),
    );
    expect(mapearPagamento(PAG({ debit_date: undefined, date_created: '2026-12-03T00:00:00Z' })).ocorridoEm).toEqual(
      new Date('2026-12-03T00:00:00Z'),
    );
  });
});
