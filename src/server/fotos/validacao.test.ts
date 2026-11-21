import { describe, expect, it } from 'vitest';

import { CODIGOS_ACAO, CODIGOS_ENVIO, ehCodigoAcao, MENSAGENS_ACAO, ehCodigoEnvio, LIMITES_FOTO, MENSAGENS_FOTO } from './tipos';
import { ehUuid, validarAlt, validarEnvioToken, validarPosicaoEsperada } from './validacao';

// D-021 T-5: CA-2 (texto alternativo), CA-7 (normalização) e CA-12 (códigos).

describe('validarAlt', () => {
  it('normaliza espaços (CA-7)', () => {
    expect(validarAlt('  Fachada   do  salão ')).toEqual({ ok: true, alt: 'Fachada do salão' });
  });
  it('aceita 150 e recusa 151 (alt_longo)', () => {
    expect(validarAlt('a'.repeat(150))).toEqual({ ok: true, alt: 'a'.repeat(150) });
    expect(validarAlt('a'.repeat(151))).toEqual({ ok: false, codigo: 'alt_longo', erro: MENSAGENS_FOTO.alt_longo });
  });
  it('recusa vazio, só espaços, quebra de linha e não texto (alt_vazio)', () => {
    for (const v of ['', '   ', 'a\nb', 'a\tb', undefined, 5]) {
      expect(validarAlt(v)).toEqual({ ok: false, codigo: 'alt_vazio', erro: MENSAGENS_FOTO.alt_vazio });
    }
    expect(validarAlt('a'.repeat(200) + '\n').ok).toBe(false);
  });
});

describe('token, posição e códigos', () => {
  it('validarEnvioToken aceita UUID (minúsculo) e recusa o resto', () => {
    expect(validarEnvioToken('3F2504E0-4F89-41D3-9A0C-0305E82C3301')).toBe('3f2504e0-4f89-41d3-9a0c-0305e82c3301');
    for (const v of ['', 'abc', undefined, 3, '../x']) expect(validarEnvioToken(v)).toBeNull();
    expect(ehUuid('3f2504e0-4f89-41d3-9a0c-0305e82c3301')).toBe(true);
  });
  it('validarPosicaoEsperada aceita 1..12 como número ou texto', () => {
    expect(validarPosicaoEsperada('3')).toBe(3);
    expect(validarPosicaoEsperada(12)).toBe(12);
    for (const v of ['0', '13', '1.5', 'x', -1, null, '']) expect(validarPosicaoEsperada(v)).toBeNull();
  });
  it('códigos de envio e de ação são listas fechadas com mensagem', () => {
    for (const c of CODIGOS_ENVIO) {
      expect(ehCodigoEnvio(c)).toBe(true);
      expect(MENSAGENS_FOTO[c]).toBeTruthy();
    }
    expect(ehCodigoEnvio('<b>x</b>')).toBe(false);
    expect(ehCodigoEnvio(undefined)).toBe(false);
    expect(ehCodigoAcao('removida')).toBe(true);
    expect(ehCodigoAcao('ok')).toBe(false);
    for (const c of CODIGOS_ACAO) expect(MENSAGENS_ACAO[c]).toBeTruthy();
    expect(LIMITES_FOTO.maxBytes).toBe(5 * 1024 * 1024);
  });
});
