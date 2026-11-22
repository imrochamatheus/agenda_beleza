import { describe, expect, it } from 'vitest';

import {
  chaveDoCorpo,
  extrairChave,
  mapearConsultado,
  reconhecerRecurso,
  redigirDigitos,
  sanitizarPayload,
} from './webhook-decisao';

const T = new Date('2027-05-10T12:00:00Z');

describe('extrairChave (CA-12)', () => {
  it('aceita x-request-id aparado de 1 a 128 caracteres visíveis', () => {
    expect(extrairChave({ 'x-request-id': '  abc-123  ' })).toBe('abc-123');
    expect(extrairChave({ 'x-request-id': 'a'.repeat(128) })).toBe('a'.repeat(128));
  });

  it.each([
    ['ausente', {}],
    ['vazio', { 'x-request-id': '' }],
    ['só espaços', { 'x-request-id': '   ' }],
    ['longo demais', { 'x-request-id': 'a'.repeat(129) }],
    ['com espaço interno', { 'x-request-id': 'a b' }],
    ['com controle', { 'x-request-id': 'a\u0007b' }],
    ['não ASCII', { 'x-request-id': 'chavé' }],
  ])('recusa %s', (_n, cab) => {
    expect(extrairChave(cab)).toBeNull();
  });
});

describe('chaveDoCorpo', () => {
  it('é um SHA-256 estável que depende do corpo', () => {
    expect(chaveDoCorpo('x', null)).toMatch(/^[0-9a-f]{64}$/);
    expect(chaveDoCorpo('x', null)).toBe(chaveDoCorpo('x', null));
    expect(chaveDoCorpo('x', null)).not.toBe(chaveDoCorpo('y', null));
    expect(chaveDoCorpo(null, null)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('sanitizarPayload (CA-4, CA-12)', () => {
  it('mantém só a lista branca de escalares', () => {
    const s = sanitizarPayload({
      id: 123,
      type: 'payment',
      action: 'payment.updated',
      live_mode: false,
      date_created: '2027-01-01T00:00:00Z',
      data: { id: 'abc', outro: 'x' },
      cartao: '1234',
      aninhado: { a: 1 },
    });
    expect(s).toEqual({
      id: 123,
      type: 'payment',
      action: 'payment.updated',
      live_mode: false,
      date_created: '2027-01-01T00:00:00Z',
      data: { id: 'abc' },
    });
  });

  it('descarta objetos, listas e nulos nos campos da lista branca', () => {
    expect(sanitizarPayload({ id: { a: 1 }, type: null, action: [1], data: { id: { x: 1 } } })).toEqual({});
    expect(sanitizarPayload({ data: 'x' })).toEqual({});
  });

  it('redige 13 ou mais dígitos em strings e números, inclusive acima de 19', () => {
    const s = sanitizarPayload({ id: '4111111111111111', type: 'a 4111-1111 e 41111111111111111111111', data: { id: 4111111111111111 } });
    expect(JSON.stringify(s)).not.toMatch(/\d{13,}/);
    expect(s.id).toBe('[redigido]');
    expect(s.data).toEqual({ id: '[redigido]' });
  });

  it('trunca strings a 200 caracteres', () => {
    expect((sanitizarPayload({ type: 'x'.repeat(500) }).type as string).length).toBe(200);
  });

  it('corpo que não é objeto vira vazio', () => {
    for (const c of [null, undefined, 'x', 3, [1, 2]]) expect(sanitizarPayload(c)).toEqual({});
  });

  it('ignora herança de protótipo', () => {
    expect(sanitizarPayload(Object.create({ id: 'herdado' }))).toEqual({});
  });
});

describe('redigirDigitos e reconhecerRecurso', () => {
  it('troca sequências longas e preserva as curtas', () => {
    expect(redigirDigitos('1234567890123 e 12345')).toBe('[redigido] e 12345');
  });

  it('só aceita identificador simples e curto, sem 13+ dígitos', () => {
    expect(reconhecerRecurso('2c938084-abc_DEF')).toBe('2c938084-abc_DEF');
    expect(reconhecerRecurso('a'.repeat(65))).toBeNull();
    expect(reconhecerRecurso('a b')).toBeNull();
    expect(reconhecerRecurso('')).toBeNull();
    expect(reconhecerRecurso(12)).toBeNull();
    expect(reconhecerRecurso('4111111111111111')).toBeNull();
  });
});

describe('mapearConsultado: o estado consultado vence o payload (CA-3)', () => {
  const pag = (status: 'aprovado' | 'recusado') => ({ id: 'p1', assinaturaId: 'a1', status, valorCentavos: 7900, ocorridoEm: T });
  const ass = (estado: 'pendente' | 'autorizada' | 'cancelada') => ({
    id: 'a1', salaoId: 's', estado, valorCentavos: 7900, autorizadaEm: T, proximaCobrancaEm: null, canceladaEm: null,
  });

  it('pagamento aprovado e recusado usam o instante do provedor', () => {
    expect(mapearConsultado({ tipo: 'pagamento', p: pag('aprovado') })).toEqual({
      acao: 'evento',
      evento: { tipo: 'cobranca_aprovada', pagamentoId: 'p1', valorCentavos: 7900, pagoEm: T },
    });
    expect(mapearConsultado({ tipo: 'pagamento', p: pag('recusado') })).toEqual({
      acao: 'evento',
      evento: { tipo: 'cobranca_falhou', pagamentoId: 'p1', valorCentavos: 7900, falhouEm: T },
    });
  });

  it('assinatura: autorizada, cancelada e pendente', () => {
    expect(mapearConsultado({ tipo: 'assinatura', p: ass('autorizada') })).toEqual({ acao: 'autorizada' });
    expect(mapearConsultado({ tipo: 'assinatura', p: ass('cancelada') })).toEqual({ acao: 'evento', evento: { tipo: 'cancelamento' } });
    expect(mapearConsultado({ tipo: 'assinatura', p: ass('pendente') })).toEqual({ acao: 'ignorar', codigo: 'estado_pendente' });
  });
});
