import { describe, expect, it } from 'vitest';

import { ACOES_AUDITAVEIS } from '@/server/auditoria/tipos';

import {
  CODIGOS_DE_ACAO,
  ESTADOS_MENSAGEM,
  TIPOS_MENSAGEM,
  codigoDeErroMostravel,
  rotuloDaAcao,
  rotuloDoTipo,
  seloDaAuditoria,
  seloDaMensagem,
  seloDoWebhook,
} from './rotulos-admin';

describe('rótulos do admin (D-045)', () => {
  it('cada estado de mensagem tem selo próprio; formas distinguem falha de sucesso', () => {
    const rotulos = ESTADOS_MENSAGEM.map((e) => seloDaMensagem(e).rotulo);
    expect(new Set(rotulos).size).toBe(ESTADOS_MENSAGEM.length);
    expect(seloDaMensagem('falhou')).toEqual({ rotulo: 'Falhou', forma: 'triangulo', variante: 'erro' });
    expect(seloDaMensagem('enviada').forma).toBe('circulo');
    expect(seloDaMensagem('pendente').rotulo).toBe('Aguardando envio');
  });

  it('estado desconhecido (inclusive nome de protótipo) → selo neutro "—"', () => {
    expect(seloDaMensagem('toString').rotulo).toBe('—');
    expect(seloDoWebhook('qualquer').rotulo).toBe('—');
    expect(seloDaAuditoria('x').rotulo).toBe('—');
  });

  it('rótulo do tipo: revisão só na remarcação', () => {
    expect(rotuloDoTipo('remarcacao', 2)).toBe('Remarcação 2');
    expect(rotuloDoTipo('cancelamento', 3)).toBe('Cancelamento');
    expect(rotuloDoTipo('confirmacao')).toBe('Confirmação');
    expect(rotuloDoTipo('xyz')).toBe('—');
    expect(TIPOS_MENSAGEM.every((t) => rotuloDoTipo(t) !== '—')).toBe(true);
  });

  it('webhook: rejeitado e erro com triângulo e texto próprios', () => {
    expect(seloDoWebhook('rejeitado')).toEqual({ rotulo: 'Rejeitado', forma: 'triangulo', variante: 'erro' });
    expect(seloDoWebhook('processado').variante).toBe('sucesso');
    expect(seloDoWebhook('recebido').variante).toBe('aviso');
    expect(seloDoWebhook('ignorado').variante).toBe('neutro');
  });

  it('toda ação auditável tem rótulo e entra na lista de filtro; ação desconhecida mostra o código', () => {
    expect([...CODIGOS_DE_ACAO].sort()).toEqual([...ACOES_AUDITAVEIS].sort());
    expect(rotuloDaAcao('mensagem.reenviar')).toBe('Mensagem reenviada');
    expect(rotuloDaAcao('foo.bar')).toBe('foo.bar');
    expect(rotuloDaAcao('constructor')).toBe('constructor');
  });

  it('código de erro mostrável só no formato fechado', () => {
    expect(codigoDeErroMostravel('resultado_incerto')).toBe('resultado_incerto');
    expect(codigoDeErroMostravel('Erro: +5571987651234')).toBeNull();
    expect(codigoDeErroMostravel('a'.repeat(41))).toBeNull();
    expect(codigoDeErroMostravel(null)).toBeNull();
    expect(codigoDeErroMostravel(7)).toBeNull();
  });
});
