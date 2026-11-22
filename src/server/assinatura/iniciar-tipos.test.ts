import { describe, expect, it } from 'vitest';

import { urlDeRetorno } from './iniciar';
import { MENSAGENS_ASSINATURA, RESULTADOS_RETORNO, mensagemDeIniciar, mensagemDeRetorno } from './iniciar-tipos';
import { rotuloDeSituacao } from './rotulos';

describe('mensagens da assinatura (D-040)', () => {
  it('todo resultado de retorno tem uma mensagem pt-BR própria, sem texto do provedor', () => {
    const textos = RESULTADOS_RETORNO.map(mensagemDeRetorno);
    expect(new Set(textos).size).toBe(RESULTADOS_RETORNO.length);
    expect(mensagemDeRetorno('teste_iniciado')).toBe(MENSAGENS_ASSINATURA.testeIniciado);
    expect(mensagemDeRetorno('neutro')).toBe(MENSAGENS_ASSINATURA.neutro);
  });

  it('mensagens do início', () => {
    expect(mensagemDeIniciar({ resultado: 'teste_iniciado' })).toBe(MENSAGENS_ASSINATURA.testeIniciado);
    expect(mensagemDeIniciar({ resultado: 'recusado', motivo: 'ja_existe' })).toBe(MENSAGENS_ASSINATURA.jaExiste);
    expect(mensagemDeIniciar({ resultado: 'provedor_indisponivel' })).toBe(MENSAGENS_ASSINATURA.provedorIndisponivel);
    expect(mensagemDeIniciar({ resultado: 'tente_novamente' })).toBe(MENSAGENS_ASSINATURA.tenteNovamente);
  });

  it('rótulos de situação', () => {
    expect(rotuloDeSituacao('sem_assinatura')).toBe('Sem assinatura');
    expect(rotuloDeSituacao('manual')).toBe('Salão suspenso pela administração');
  });

  it('urlDeRetorno normaliza APP_URL com barra final ou caminho', () => {
    expect(urlDeRetorno('http://localhost:3000')).toBe('http://localhost:3000/painel/assinatura/retorno');
    expect(urlDeRetorno('http://localhost:3000/')).toBe('http://localhost:3000/painel/assinatura/retorno');
    expect(urlDeRetorno('https://app.exemplo.com/base/x/')).toBe('https://app.exemplo.com/painel/assinatura/retorno');
  });
});
