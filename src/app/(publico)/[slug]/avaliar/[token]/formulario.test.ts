import { describe, expect, it } from 'vitest';

import { MENSAGEM_LINK_INVALIDO, MENSAGENS_AVALIACAO } from '@/server/avaliacoes/tipos';

import { lerFormulario, paraEstado } from './formulario';

function fd(campos: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
}

describe('lerFormulario', () => {
  it('lê os campos, o IP e o token de verificação humana', () => {
    const { entrada, valores } = lerFormulario(
      fd({ slug: 's', token: 't', nota: '4', comentario: 'ok', aceite_publicacao: 'on', 'cf-turnstile-response': 'h' }),
      '198.51.100.1',
    );
    expect(entrada).toEqual({ slug: 's', token: 't', nota: '4', comentario: 'ok', aceite: 'on', ip: '198.51.100.1', tokenHumano: 'h' });
    expect(valores).toEqual({ nota: '4', comentario: 'ok', aceite: true });
  });

  it('ausentes viram vazio/null e o aceite só vale com "on"', () => {
    const { entrada, valores } = lerFormulario(new FormData(), 'x');
    expect(entrada).toMatchObject({ slug: '', token: '', nota: '', comentario: '', aceite: null, tokenHumano: null });
    expect(valores).toEqual({ nota: '', comentario: '', aceite: false });
    expect(lerFormulario(fd({ aceite_publicacao: 'false' }), 'x').valores.aceite).toBe(false);
  });

  it('arquivo no lugar de texto é ignorado; eco e token humano têm teto', () => {
    const f = new FormData();
    f.set('nota', new File(['x'], 'a.txt'));
    f.set('comentario', 'c'.repeat(10_000));
    f.set('cf-turnstile-response', 'h'.repeat(5000));
    const { entrada, valores } = lerFormulario(f, 'x');
    expect(entrada.nota).toBe('');
    expect(valores.comentario).toHaveLength(4000);
    expect((entrada.tokenHumano as string).length).toBe(2100);
  });
});

describe('paraEstado', () => {
  const v = { nota: '3', comentario: 'x', aceite: true };
  it('enviada limpa os valores', () => {
    expect(paraEstado({ resultado: 'enviada' }, v)).toEqual({
      status: 'enviada', mensagem: MENSAGENS_AVALIACAO.enviada, erros: {}, valores: { nota: '', comentario: '', aceite: false },
    });
  });
  it('campos inválidos mantêm os valores', () => {
    expect(paraEstado({ resultado: 'invalido_campos', erros: { nota: 'n' } }, v)).toEqual({ status: 'editando', mensagem: null, erros: { nota: 'n' }, valores: v });
  });
  it('link inválido, limite e verificação', () => {
    expect(paraEstado({ resultado: 'link_invalido' }, v)).toMatchObject({ status: 'invalido', mensagem: MENSAGEM_LINK_INVALIDO });
    expect(paraEstado({ resultado: 'limite_excedido' }, v)).toMatchObject({ status: 'limitado', mensagem: MENSAGENS_AVALIACAO.limitado });
    expect(paraEstado({ resultado: 'verificacao_falhou' }, v)).toMatchObject({ status: 'editando', mensagem: MENSAGENS_AVALIACAO.humano, valores: v });
  });
});
