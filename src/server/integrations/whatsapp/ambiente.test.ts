import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { CHAVES, IDIOMA_PADRAO, lerConfigReal, SELETOR, VERSAO_API_PADRAO } from './ambiente';
import { MODELOS_WHATSAPP } from './port';

const COMPLETA = {
  WHATSAPP_ACCESS_TOKEN: '  tok  ',
  WHATSAPP_PHONE_NUMBER_ID: '109876543210',
  WHATSAPP_TEMPLATE_CONFIRMACAO: 'agenda_confirmacao',
  WHATSAPP_TEMPLATE_REMARCACAO: 'agenda_remarcacao',
  WHATSAPP_TEMPLATE_CANCELAMENTO: 'agenda_cancelamento',
  WHATSAPP_TEMPLATE_CONVITE_AVALIACAO: 'agenda_convite_avaliacao',
};

describe('whatsapp/ambiente (D-047)', () => {
  it('declara o seletor e as oito variáveis do provedor', () => {
    expect(SELETOR).toBe('WHATSAPP_ADAPTER');
    expect([...CHAVES].sort()).toEqual([...CHAVES]);
    expect(CHAVES).toHaveLength(8);
    expect(VERSAO_API_PADRAO).toBe('v25.0');
    expect(IDIOMA_PADRAO).toBe('pt_BR');
  });

  it('não importa nada (entra no bundle do check-env)', () => {
    const fonte = readFileSync(fileURLToPath(new URL('./ambiente.ts', import.meta.url)), 'utf8');
    expect(fonte).not.toMatch(/^import /m);
  });

  it('CA-9: sem nada, nomeia as seis obrigatórias, ordenadas', () => {
    expect(lerConfigReal({})).toEqual({
      ok: false,
      variaveis: [
        'WHATSAPP_ACCESS_TOKEN',
        'WHATSAPP_PHONE_NUMBER_ID',
        'WHATSAPP_TEMPLATE_CANCELAMENTO',
        'WHATSAPP_TEMPLATE_CONFIRMACAO',
        'WHATSAPP_TEMPLATE_CONVITE_AVALIACAO',
        'WHATSAPP_TEMPLATE_REMARCACAO',
      ],
    });
  });

  it('config completa: trim, padrões de versão e idioma, um nome por modelo da porta', () => {
    const r = lerConfigReal(COMPLETA);
    expect(r).toEqual({
      ok: true,
      config: {
        accessToken: 'tok',
        phoneNumberId: '109876543210',
        versaoApi: 'v25.0',
        idioma: 'pt_BR',
        modelos: {
          confirmacao: 'agenda_confirmacao',
          remarcacao: 'agenda_remarcacao',
          cancelamento: 'agenda_cancelamento',
          convite_avaliacao: 'agenda_convite_avaliacao',
        },
      },
    });
    if (!r.ok) throw new Error('inesperado');
    expect(Object.keys(r.config.modelos).sort()).toEqual([...MODELOS_WHATSAPP].sort());
  });

  it('versão e idioma informados valem; formatos inválidos são nomeados sem valores', () => {
    const ok = lerConfigReal({ ...COMPLETA, WHATSAPP_API_VERSION: 'v23.0', WHATSAPP_TEMPLATE_IDIOMA: 'en_US' });
    expect(ok.ok && [ok.config.versaoApi, ok.config.idioma]).toEqual(['v23.0', 'en_US']);
    for (const [chave, ruim] of [
      ['WHATSAPP_API_VERSION', 'abc'],
      ['WHATSAPP_API_VERSION', '25'],
      ['WHATSAPP_TEMPLATE_IDIOMA', 'pt-BR'],
      ['WHATSAPP_PHONE_NUMBER_ID', 'abc'],
      ['WHATSAPP_PHONE_NUMBER_ID', '1'.repeat(33)],
      ['WHATSAPP_TEMPLATE_CONFIRMACAO', 'Confirmacao'],
      ['WHATSAPP_TEMPLATE_CANCELAMENTO', 'a'.repeat(513)],
    ] as const) {
      expect(lerConfigReal({ ...COMPLETA, [chave]: ruim }), `${chave}=${ruim}`).toEqual({ ok: false, variaveis: [chave] });
    }
  });
});
