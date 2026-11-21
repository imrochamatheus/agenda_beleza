import { describe, expect, it } from 'vitest';

import { MENSAGENS_MODERACAO } from '@/server/denuncias/tipos';

import { CODIGOS_RESULTADO, TEXTOS_RESULTADO, codigoDoResultado, lerResultado } from './resultado';

describe('lerResultado', () => {
  it('só aceita códigos da lista fechada (o primeiro valor de uma lista)', () => {
    for (const c of CODIGOS_RESULTADO) expect(lerResultado(c)).toBe(c);
    expect(lerResultado(['retirada', 'x'])).toBe('retirada');
    for (const v of ['', 'RETIRADA', 'toString', '<script>', undefined, null, 3, [], {}]) expect(lerResultado(v)).toBeNull();
  });

  it('todo código tem variante e texto', () => {
    for (const c of CODIGOS_RESULTADO) expect(TEXTOS_RESULTADO[c].texto.length).toBeGreaterThan(0);
  });
});

describe('codigoDoResultado', () => {
  const ok = (dados: object) => ({ ok: true as const, dados }) as never;
  it('mapeia o resultado de negócio, por operação', () => {
    expect(codigoDoResultado('retirar', ok({ resultado: 'ok' }))).toBe('retirada');
    expect(codigoDoResultado('restaurar', ok({ resultado: 'ok' }))).toBe('restaurada');
    expect(codigoDoResultado('arquivar', ok({ resultado: 'ok' }))).toBe('arquivadas');
    expect(codigoDoResultado('retirar', ok({ resultado: 'recusado', motivo: 'estado_atual' }))).toBe('estado_atual');
    expect(codigoDoResultado('arquivar', ok({ resultado: 'recusado', motivo: 'sem_pendentes' }))).toBe('sem_pendentes');
    expect(codigoDoResultado('retirar', ok({ resultado: 'invalido', erro: MENSAGENS_MODERACAO.motivoComDados }))).toBe('motivo_dados');
    expect(codigoDoResultado('retirar', ok({ resultado: 'invalido', erro: MENSAGENS_MODERACAO.motivoObrigatorio }))).toBe('motivo_invalido');
  });

  it('401, 403 e 404 da ação', () => {
    expect(codigoDoResultado('retirar', { ok: false, erro: 'nao_autenticado', status: 401 })).toBe('nao_autenticado');
    expect(codigoDoResultado('retirar', { ok: false, erro: 'acesso_negado', status: 403 })).toBe('negado');
    expect(codigoDoResultado('retirar', { ok: false, erro: 'nao_encontrado', status: 404 })).toBe('nao_encontrada');
  });
});
