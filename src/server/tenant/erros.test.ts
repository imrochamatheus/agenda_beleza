import { describe, expect, it } from 'vitest';

import {
  AcessoNegado,
  ErroDeDominio,
  NaoAutenticado,
  NaoEncontrado,
  ehErroDeDominio,
  respostaDeErro,
} from './erros';

describe('erros de domínio', () => {
  it('mapeiam para 401, 403 e 404 com corpo só com o código', () => {
    expect(respostaDeErro(new NaoAutenticado())).toEqual({
      status: 401,
      corpo: { erro: 'nao_autenticado' },
    });
    expect(respostaDeErro(new AcessoNegado('motivo interno'))).toEqual({
      status: 403,
      corpo: { erro: 'acesso_negado' },
    });
    expect(respostaDeErro(new NaoEncontrado())).toEqual({
      status: 404,
      corpo: { erro: 'nao_encontrado' },
    });
  });

  it('têm mensagens constantes, sem dados do recurso', () => {
    expect(new NaoAutenticado().message).toBe('Não autenticado');
    expect(new AcessoNegado('papel x').message).toBe('Acesso negado');
    expect(new NaoEncontrado().message).toBe('Recurso não encontrado');
    // Duas instâncias são indistinguíveis no corpo e na mensagem (CA-8).
    expect(respostaDeErro(new NaoEncontrado())).toEqual(respostaDeErro(new NaoEncontrado()));
  });

  it('guarda o motivo do AcessoNegado só como diagnóstico, fora do corpo', () => {
    const erro = new AcessoNegado('salão suspenso');
    expect(erro.motivo).toBe('salão suspenso');
    expect(JSON.stringify(respostaDeErro(erro))).not.toContain('suspenso');
    expect(new AcessoNegado().motivo).toBeUndefined();
  });

  it('identifica erros de domínio e nomeia as classes', () => {
    const erros = [new NaoAutenticado(), new AcessoNegado(), new NaoEncontrado()];
    expect(erros.every((e) => e instanceof ErroDeDominio && e instanceof Error)).toBe(true);
    expect(erros.map((e) => e.name)).toEqual(['NaoAutenticado', 'AcessoNegado', 'NaoEncontrado']);
    expect(erros.every(ehErroDeDominio)).toBe(true);
    expect(ehErroDeDominio(new Error('x'))).toBe(false);
    expect(ehErroDeDominio({ codigo: 'nao_encontrado', status: 404 })).toBe(false);
  });
});
