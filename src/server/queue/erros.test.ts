import { describe, expect, it } from 'vitest';

import { descreverErroSeguro, ErroFilaIndisponivel, ErroPayloadInvalido } from './erros';

const URL = 'postgresql://agenda:s3nh@-forte@db.interno:5432/agenda';
const URL_CODIFICADA = 'postgresql://agenda:s3nh%40-forte@db.interno:5432/agenda';

function comCodigo(mensagem: string, code: string) {
  return Object.assign(new Error(mensagem), { code });
}

describe('descreverErroSeguro', () => {
  it('remove a URL inteira, a senha (crua e decodificada) e usuario:senha de qualquer URL', () => {
    const erro = new Error(
      `falhou em ${URL_CODIFICADA}; senha s3nh@-forte; outra postgres://x:y@h/d e //u:p@host`,
    );
    const d = descreverErroSeguro(erro, URL_CODIFICADA);
    expect(d.nome).toBe('Error');
    expect(d.codigo).toBeNull();
    expect(d.mensagem).not.toContain('s3nh');
    expect(d.mensagem).not.toContain('x:y');
    expect(d.mensagem).not.toContain('u:p');
    expect(d.mensagem).toContain('***');
  });

  it('sem url ainda remove URLs postgres e credenciais embutidas', () => {
    const d = descreverErroSeguro(new Error('conectando em postgresql://a:segredo@h:1/d'));
    expect(d.mensagem).toBe('conectando em ***');
  });

  it('preserva o código (SQLSTATE ou do Node) e corta a mensagem em 300 caracteres', () => {
    const d = descreverErroSeguro(comCodigo('x'.repeat(500), 'ECONNREFUSED'));
    expect(d.codigo).toBe('ECONNREFUSED');
    expect(d.mensagem).toHaveLength(300);
  });

  it('aceita valores que não são Error', () => {
    expect(descreverErroSeguro('texto')).toEqual({ nome: 'string', codigo: null, mensagem: 'texto' });
    expect(descreverErroSeguro(null)).toEqual({ nome: 'object', codigo: null, mensagem: '' });
    expect(descreverErroSeguro(42, 'nao-e-url')).toEqual({ nome: 'number', codigo: null, mensagem: '' });
  });
});

describe('ErroFilaIndisponivel (RN-12)', () => {
  it.each([
    [new Error('pg-boss is not installed'), 'schema_ausente', null],
    [new Error('pg-boss database requires migrations'), 'schema_ausente', null],
    [comCodigo('relation "pgboss.job" does not exist', '42P01'), 'schema_ausente', '42P01'],
    [comCodigo('schema "pgboss" does not exist', '3F000'), 'schema_ausente', '3F000'],
    [comCodigo('Queue x does not exist', 'PGBOSS_QUEUE_NOT_FOUND'), 'fila_inexistente', 'PGBOSS_QUEUE_NOT_FOUND'],
    [comCodigo(`connect ECONNREFUSED em ${URL}`, 'ECONNREFUSED'), 'conexao', 'ECONNREFUSED'],
  ])('%s → motivo %s', (original, motivo, codigo) => {
    const erro = new ErroFilaIndisponivel('exemplo', original);
    expect(erro).toBeInstanceOf(Error);
    expect(erro.name).toBe('ErroFilaIndisponivel');
    expect(erro.fila).toBe('exemplo');
    expect(erro.motivo).toBe(motivo);
    expect(erro.codigo).toBe(codigo);
    expect(erro.message).toBe(`Fila "exemplo" indisponível (${motivo})`);
    expect(erro.cause).toEqual({ nome: 'Error', codigo });
    expect(JSON.stringify(erro.cause)).not.toContain('s3nh');
  });
});

describe('ErroPayloadInvalido', () => {
  it('ordena e remove campos repetidos, sem valores', () => {
    const erro = new ErroPayloadInvalido('whatsapp-reserva', ['telefone', 'mensagemId', 'telefone']);
    expect(erro.name).toBe('ErroPayloadInvalido');
    expect(erro.fila).toBe('whatsapp-reserva');
    expect(erro.campos).toEqual(['mensagemId', 'telefone']);
    expect(erro.message).toBe('Payload inválido para a fila "whatsapp-reserva": mensagemId, telefone');
  });
});
