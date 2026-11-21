import { describe, expect, it } from 'vitest';

import { LIMITE_TEXTO_DENUNCIA } from './tipos';
import { ehMotivo, lerFiltrosDaFila, normalizarTexto, temDadoPessoalObvio, validarDenuncia, validarMotivoModeracao } from './validacao';

describe('validarDenuncia (CA-3)', () => {
  it('aceita só motivos da lista fechada e devolve texto normalizado ou null', () => {
    expect(validarDenuncia({ motivo: 'spam', texto: '  a \n b  ' })).toEqual({ ok: true, dados: { motivo: 'spam', texto: 'a b' } });
    expect(validarDenuncia({ motivo: 'outro' })).toEqual({ ok: true, dados: { motivo: 'outro', texto: null } });
    expect(validarDenuncia({ motivo: 'outro', texto: '   ' })).toEqual({ ok: true, dados: { motivo: 'outro', texto: null } });
    for (const m of ['', 'SPAM', 'x', null, undefined, 3, {}, ['spam']]) {
      expect(validarDenuncia({ motivo: m })).toMatchObject({ ok: false, erros: { motivo: expect.any(String) } });
    }
  });

  it('texto com mais de 500 pontos de código é recusado; exatamente 500 passa; emoji conta 1', () => {
    expect(validarDenuncia({ motivo: 'spam', texto: 'x'.repeat(LIMITE_TEXTO_DENUNCIA) }).ok).toBe(true);
    expect(validarDenuncia({ motivo: 'spam', texto: '😀'.repeat(LIMITE_TEXTO_DENUNCIA) }).ok).toBe(true);
    expect(validarDenuncia({ motivo: 'spam', texto: 'x'.repeat(LIMITE_TEXTO_DENUNCIA + 1) })).toMatchObject({ ok: false, erros: { texto: expect.any(String) } });
  });

  it('erro de texto e de motivo juntos; texto que não é string vira vazio; NUL é removido', () => {
    expect(validarDenuncia({ motivo: 'x', texto: 'y'.repeat(501) })).toMatchObject({ ok: false, erros: { motivo: expect.any(String), texto: expect.any(String) } });
    expect(normalizarTexto(42)).toBe('');
    expect(normalizarTexto('a\u0000b')).toBe('ab');
    expect(ehMotivo('falso')).toBe(true);
    expect(ehMotivo('toString')).toBe(false);
  });
});

describe('validarMotivoModeracao (CA-12)', () => {
  it('3 a 300 caracteres, normalizado', () => {
    expect(validarMotivoModeracao('  Conteúdo   ofensivo ')).toEqual({ ok: true, motivo: 'Conteúdo ofensivo' });
    expect(validarMotivoModeracao('abc').ok).toBe(true);
    expect(validarMotivoModeracao('x'.repeat(300)).ok).toBe(true);
    for (const v of ['', 'ab', '  ', 'x'.repeat(301), null, undefined, 7]) expect(validarMotivoModeracao(v).ok).toBe(false);
  });

  it('rejeita e-mail e telefone óbvios, mas aceita números curtos e datas', () => {
    for (const v of ['mande para a@b.co', 'ligue 11 98765-4321', '(11) 3333-4444 urgente', '+55 11 98765 4321', '11987654321']) {
      expect(validarMotivoModeracao(v)).toEqual({ ok: false, erro: expect.stringContaining('e-mail nem telefone') });
    }
    for (const v of ['nota 5 de 5', 'caso 123', 'em 2026 aconteceu', 'viu 1.234 vezes']) expect(validarMotivoModeracao(v).ok).toBe(true);
    expect(temDadoPessoalObvio('sem dados')).toBe(false);
  });
});

describe('lerFiltrosDaFila (CA-10)', () => {
  it('valor inválido vira "sem filtro"; página só ^[1-9]\\d{0,6}$; primeiro valor de lista', () => {
    const u = '5d2a9b1c-3e4f-4a5b-8c6d-7e8f9a0b1c2D';
    expect(lerFiltrosDaFila({ salao: u, estado: 'retirada', pagina: '3' })).toEqual({ salaoId: u.toLowerCase(), estado: 'retirada', pagina: 3 });
    expect(lerFiltrosDaFila({ salao: 'x', estado: 'qualquer', pagina: '0' })).toEqual({ salaoId: null, estado: null, pagina: 1 });
    expect(lerFiltrosDaFila({ salao: [u, 'y'], estado: ['visivel', 'retirada'], pagina: ['2'] })).toEqual({ salaoId: u.toLowerCase(), estado: 'visivel', pagina: 2 });
    expect(lerFiltrosDaFila({})).toEqual({ salaoId: null, estado: null, pagina: 1 });
    expect(lerFiltrosDaFila({ pagina: '12345678' }).pagina).toBe(1);
  });
});
