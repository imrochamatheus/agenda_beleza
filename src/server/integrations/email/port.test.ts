import { describe, expect, it } from 'vitest';

import {
  type CampoMensagemEmail,
  ErroEnvioEmail,
  ErroValidacaoEmail,
  type MensagemEmail,
  validarMensagemEmail,
} from './port';

const VALIDA: MensagemEmail = {
  para: 'cliente@exemplo.com',
  assunto: 'Confirme seu e-mail',
  texto: 'Acesse http://localhost:3000/confirmar?token=abc',
};

function campoInvalido(m: MensagemEmail): CampoMensagemEmail {
  try {
    validarMensagemEmail(m);
  } catch (erro) {
    expect(erro).toBeInstanceOf(ErroValidacaoEmail);
    return (erro as ErroValidacaoEmail).campo;
  }
  throw new Error('validarMensagemEmail deveria ter lançado');
}

describe('validarMensagemEmail (RN-9, CA-23)', () => {
  it('aceita uma mensagem válida, com e sem html', () => {
    expect(() => validarMensagemEmail(VALIDA)).not.toThrow();
    expect(() => validarMensagemEmail({ ...VALIDA, html: '<p>oi</p>' })).not.toThrow();
  });

  it.each([
    ['inválido', 'nao-e-email'],
    ['vazio', ''],
    ['com vírgula (vários destinatários)', 'a@exemplo.com,b@exemplo.com'],
    ['com ponto e vírgula (vários destinatários)', 'a@exemplo.com; b@exemplo.com'],
    ['com nome e sinais de maior/menor', 'Ana <ana@exemplo.com>'],
    ['com CRLF (injeção de cabeçalho)', 'a@exemplo.com\r\nBcc: x@exemplo.com'],
    ['com LF', 'a@exemplo.com\nBcc: x@exemplo.com'],
  ])('CA-23: destinatário %s → erro de validação em "para"', (_caso, para) => {
    expect(campoInvalido({ ...VALIDA, para })).toBe('para');
  });

  it.each([
    ['com CRLF', 'Olá\r\nBcc: x@exemplo.com'],
    ['com CR', 'Olá\rBcc: x@exemplo.com'],
    ['com LF', 'Olá\nBcc: x@exemplo.com'],
    ['vazio', ''],
    ['só com espaços', '   '],
  ])('CA-23: assunto %s → erro de validação em "assunto"', (_caso, assunto) => {
    expect(campoInvalido({ ...VALIDA, assunto })).toBe('assunto');
  });

  it.each([
    ['vazio', ''],
    ['só com espaços', ' \n '],
  ])('CA-23: texto %s → erro de validação em "texto"', (_caso, texto) => {
    expect(campoInvalido({ ...VALIDA, texto })).toBe('texto');
  });

  it('rejeita campos que não são string (entrada vinda de fora do tipo)', () => {
    expect(campoInvalido({ ...VALIDA, para: undefined as unknown as string })).toBe('para');
    expect(campoInvalido({ ...VALIDA, assunto: null as unknown as string })).toBe('assunto');
    expect(campoInvalido({ ...VALIDA, texto: 1 as unknown as string })).toBe('texto');
  });

  it('a mensagem de erro é fixa e não ecoa o valor recebido', () => {
    let erro: ErroValidacaoEmail | undefined;
    try {
      validarMensagemEmail({ ...VALIDA, para: 'valor-secreto-xyz' });
    } catch (e) {
      erro = e as ErroValidacaoEmail;
    }
    expect(erro?.name).toBe('ErroValidacaoEmail');
    expect(erro?.message).toBe('E-mail inválido: o destinatário deve ser um único endereço válido.');
    expect(JSON.stringify(erro)).not.toContain('valor-secreto-xyz');
  });
});

describe('ErroEnvioEmail', () => {
  it.each([
    ['conexao', true],
    ['autenticacao', false],
    ['recusado', false],
    ['outro', true],
  ] as const)('código %s: mensagem fixa, sem cause', (codigo, temporario) => {
    const erro = new ErroEnvioEmail(codigo, temporario);
    expect(erro).toBeInstanceOf(Error);
    expect(erro.name).toBe('ErroEnvioEmail');
    expect(erro.codigo).toBe(codigo);
    expect(erro.temporario).toBe(temporario);
    expect(erro.message).toMatch(/^Falha no envio do e-mail/);
    expect(erro.cause).toBeUndefined();
  });

  it('cada código tem uma mensagem distinta', () => {
    const mensagens = (['conexao', 'autenticacao', 'recusado', 'outro'] as const).map(
      (c) => new ErroEnvioEmail(c, false).message,
    );
    expect(new Set(mensagens).size).toBe(4);
  });
});
