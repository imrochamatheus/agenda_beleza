import { describe, expect, it } from 'vitest';

import { MENSAGENS_AVALIACAO } from './tipos';
import { lerNota, normalizarComentario, validarCampos } from './validacao';

describe('lerNota', () => {
  it.each([['1', 1], ['5', 5], [3, 3], ['3', 3]])('aceita %j', (v, n) => expect(lerNota(v)).toBe(n));
  it.each([['0'], ['6'], ['3.5'], [3.5], [0], [6], ['01'], [' 3'], ['3 '], ['abc'], [''], [null], [undefined], [NaN], [{}], [[3]], ['+3'], ['٣']])(
    'recusa %j',
    (v) => expect(lerNota(v)).toBeNull(),
  );
});

describe('normalizarComentario', () => {
  it('apara, colapsa espaços e quebras e remove NUL', () => {
    expect(normalizarComentario('  Muito \n\n bom\t\tmesmo \u0000 ')).toBe('Muito bom mesmo');
  });
  it('não-texto vira vazio', () => {
    expect(normalizarComentario(undefined)).toBe('');
    expect(normalizarComentario(5)).toBe('');
  });
  it('mantém HTML como texto', () => {
    expect(normalizarComentario('<b>x</b>')).toBe('<b>x</b>');
  });
});

describe('validarCampos (RN-7)', () => {
  const ok = { nota: '5', comentario: 'Ótimo', aceite: 'on' };

  it('válido: nota numérica e comentário normalizado; vazio vira null', () => {
    expect(validarCampos(ok)).toEqual({ ok: true, dados: { nota: 5, comentario: 'Ótimo' } });
    expect(validarCampos({ ...ok, comentario: '   ' })).toEqual({ ok: true, dados: { nota: 5, comentario: null } });
    expect(validarCampos({ ...ok, comentario: undefined, aceite: true })).toEqual({ ok: true, dados: { nota: 5, comentario: null } });
  });

  it('o limite de 1000 conta caracteres (code points), não unidades UTF-16', () => {
    expect(validarCampos({ ...ok, comentario: '😀'.repeat(1000) }).ok).toBe(true);
    const r = validarCampos({ ...ok, comentario: '😀'.repeat(1001) });
    expect(r).toEqual({ ok: false, erros: { comentario: MENSAGENS_AVALIACAO.comentario } });
  });

  it('o limite vale depois do colapso de espaços', () => {
    expect(validarCampos({ ...ok, comentario: `${'a '.repeat(500)}${' '.repeat(50)}` }).ok).toBe(true);
  });

  it('reúne todos os erros de campo', () => {
    expect(validarCampos({ nota: '9', comentario: 'x'.repeat(1001), aceite: 'false' })).toEqual({
      ok: false,
      erros: { nota: MENSAGENS_AVALIACAO.nota, comentario: MENSAGENS_AVALIACAO.comentario, aceite: MENSAGENS_AVALIACAO.aceite },
    });
  });

  it.each([[undefined], [null], [false], ['off'], ['1'], [1], ['true']])('aceite estrito: recusa %j', (aceite) => {
    expect(validarCampos({ ...ok, aceite })).toEqual({ ok: false, erros: { aceite: MENSAGENS_AVALIACAO.aceite } });
  });
});
