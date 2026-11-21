import { describe, expect, it } from 'vitest';

import { MENSAGENS_EXCLUSAO, mensagemDeExclusao } from './tipos';

describe('mensagemDeExclusao (?exclusao= do detalhe)', () => {
  it('só os três códigos da lista fechada têm texto', () => {
    expect(mensagemDeExclusao('ok')).toEqual({ variante: 'sucesso', texto: MENSAGENS_EXCLUSAO.ok });
    expect(mensagemDeExclusao('ja_anonimizada')).toEqual({ variante: 'info', texto: MENSAGENS_EXCLUSAO.jaAnonimizada });
    expect(mensagemDeExclusao('negado')).toEqual({ variante: 'erro', texto: MENSAGENS_EXCLUSAO.acessoNegado });
  });

  it.each([undefined, '', 'OK', '<b>x</b>', ['ok'], 1, null])('qualquer outro valor (%j) é ignorado', (v) => {
    expect(mensagemDeExclusao(v)).toBeNull();
  });
});
