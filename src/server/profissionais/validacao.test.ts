import { describe, expect, it } from 'vitest';

import { MENSAGENS_PROFISSIONAL } from './tipos';
import { LIMITES_PROFISSIONAL, normalizarEmailOpcional, validarDadosProfissional } from './validacao';

// D-013 CA-12 (RN-9): validação pura dos dados do profissional.

const M = MENSAGENS_PROFISSIONAL;

describe('validarDadosProfissional', () => {
  it('nome aparado e com espaços colapsados; e-mail ausente, vazio ou só espaços → null', () => {
    for (const email of [undefined, '', '   ', null]) {
      expect(validarDadosProfissional({ nome: '  Ana   Paula ', email })).toEqual({
        ok: true,
        dados: { nome: 'Ana Paula', email: null },
      });
    }
    expect(validarDadosProfissional({ nome: 'Ana' })).toEqual({ ok: true, dados: { nome: 'Ana', email: null } });
  });

  it('e-mail aparado e em minúsculas: "  ANA@Exemplo.COM " → ana@exemplo.com', () => {
    expect(validarDadosProfissional({ nome: 'Ana', email: '  ANA@Exemplo.COM ' })).toEqual({
      ok: true,
      dados: { nome: 'Ana', email: 'ana@exemplo.com' },
    });
  });

  it('limites do nome: 1 e 101 recusados; 2 e 100 aceitos; vazio e só espaços recusados', () => {
    expect(LIMITES_PROFISSIONAL.nome).toEqual({ min: 2, max: 100 });
    for (const nome of ['', '   ', 'A', 'a'.repeat(101), undefined, 7, 'Ana\nPaula']) {
      expect(validarDadosProfissional({ nome }), String(nome)).toEqual({ ok: false, erros: { nome: M.nome } });
    }
    for (const nome of ['Al', 'a'.repeat(100)]) {
      expect(validarDadosProfissional({ nome })).toEqual({ ok: true, dados: { nome, email: null } });
    }
  });

  it('e-mail inválido: "ana@", 255 caracteres, não texto; 254 caracteres aceito', () => {
    const local254 = `${'a'.repeat(254 - '@exemplo.com'.length)}@exemplo.com`;
    expect(local254).toHaveLength(254);
    const com255 = `a${local254}`;
    for (const email of ['ana@', com255, 'sem-arroba', 42, {}]) {
      expect(validarDadosProfissional({ nome: 'Ana', email }), String(email)).toEqual({
        ok: false,
        erros: { email: M.email },
      });
    }
    // Formato aceito pelo esquema do cadastro (o tamanho é o teto; a parte local longa não é testada aqui).
    expect(normalizarEmailOpcional('bia@exemplo.com')).toBe('bia@exemplo.com');
    expect(normalizarEmailOpcional(com255)).toBeUndefined();
  });

  it('todos os erros juntos', () => {
    expect(validarDadosProfissional({ nome: 'A', email: 'ana@' })).toEqual({
      ok: false,
      erros: { nome: M.nome, email: M.email },
    });
  });

  it('campos extras, não objeto ou array → erro de formulário', () => {
    for (const e of [{ nome: 'Ana', usuarioId: 'x' }, { nome: 'Ana', salaoId: 'x' }, null, 'Ana', ['Ana'], 3]) {
      expect(validarDadosProfissional(e), JSON.stringify(e)).toEqual({ ok: false, erros: { formulario: M.formulario } });
    }
  });
});
