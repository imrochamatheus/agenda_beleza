import { describe, expect, it } from 'vitest';

import { ErroPayloadInvalido } from './erros';
import { CONTRATOS, ehNomeFila, FILA, type NomeFila, validarPayload } from './filas';

const UUID = '6f1c2b8e-3d4a-4b5c-9d6e-7f8091a2b3c4';

function falha(fila: string, dados: unknown): ErroPayloadInvalido {
  try {
    validarPayload(fila as NomeFila, dados);
  } catch (e) {
    expect(e).toBeInstanceOf(ErroPayloadInvalido);
    return e as ErroPayloadInvalido;
  }
  throw new Error('validarPayload deveria ter falhado');
}

describe('FILA e CONTRATOS (RN-8)', () => {
  it('têm exatamente as 4 filas de produção, com nomes únicos', () => {
    const nomes = Object.values(FILA);
    expect(nomes.sort()).toEqual(['assinatura-prazos', 'exemplo', 'reconciliar-mensagens', 'whatsapp-reserva']);
    expect(new Set(nomes).size).toBe(nomes.length);
    expect(Object.keys(CONTRATOS).sort()).toEqual(nomes.sort());
  });

  it('D-7: whatsapp-reserva e os crons são exclusive; whatsapp-reserva exige chave; exemplo é standard', () => {
    expect(CONTRATOS['whatsapp-reserva']).toMatchObject({ politica: 'exclusive', chave: 'obrigatoria' });
    expect(CONTRATOS['assinatura-prazos']).toMatchObject({ politica: 'exclusive', chave: 'opcional' });
    expect(CONTRATOS['reconciliar-mensagens']).toMatchObject({ politica: 'exclusive', chave: 'opcional' });
    expect(CONTRATOS.exemplo).toMatchObject({ politica: 'standard', chave: 'opcional' });
  });

  it('ehNomeFila reconhece só as filas de produção', () => {
    expect(ehNomeFila('exemplo')).toBe(true);
    expect(ehNomeFila('toString')).toBe(false);
    expect(ehNomeFila('outra')).toBe(false);
    expect(ehNomeFila(1)).toBe(false);
  });
});

describe('validarPayload (CA-10, unitário)', () => {
  it('aceita os payloads válidos de cada fila', () => {
    expect(validarPayload('whatsapp-reserva', { mensagemId: UUID })).toEqual({ mensagemId: UUID });
    expect(validarPayload('assinatura-prazos', {})).toEqual({});
    expect(validarPayload('reconciliar-mensagens', {})).toEqual({});
    expect(validarPayload('exemplo', {})).toEqual({});
    expect(validarPayload('exemplo', { esperaMs: 0 })).toEqual({ esperaMs: 0 });
    expect(validarPayload('exemplo', { esperaMs: 60_000 })).toEqual({ esperaMs: 60_000 });
  });

  it('recusa campo extra (dado pessoal) nomeando o campo, sem o valor', () => {
    const erro = falha('whatsapp-reserva', { mensagemId: UUID, telefone: '+5511999998888' });
    expect(erro.campos).toEqual(['telefone']);
    expect(erro.message).not.toContain('5511999998888');
  });

  it('recusa id que não é UUID', () => {
    const erro = falha('whatsapp-reserva', { mensagemId: '123' });
    expect(erro.campos).toEqual(['mensagemId']);
    expect(erro.message).not.toContain('123');
  });

  it('recusa campo obrigatório ausente', () => {
    expect(falha('whatsapp-reserva', {}).campos).toEqual(['mensagemId']);
  });

  it.each([null, 'texto', 42, [UUID], undefined])('recusa payload que não é objeto: %j', (dados) => {
    expect(falha('whatsapp-reserva', dados).campos).toEqual(['(raiz)']);
  });

  it('recusa campos em payload de cron', () => {
    expect(falha('assinatura-prazos', { salaoId: UUID }).campos).toEqual(['salaoId']);
  });

  it.each([-1, 60_001, 1.5, '10'])('D-4: recusa esperaMs %j', (esperaMs) => {
    expect(falha('exemplo', { esperaMs }).campos).toEqual(['esperaMs']);
  });

  it('fila desconhecida vira ErroPayloadInvalido com (fila)', () => {
    const erro = falha('desconhecida', {});
    expect(erro.fila).toBe('desconhecida');
    expect(erro.campos).toEqual(['(fila)']);
  });
});
