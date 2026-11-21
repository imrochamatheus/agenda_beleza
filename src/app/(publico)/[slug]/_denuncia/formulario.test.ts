import { describe, expect, it } from 'vitest';

import { MENSAGENS_DENUNCIA } from '@/server/denuncias/tipos';

import { lerFormularioDenuncia, paraEstadoDenuncia } from './formulario';

const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

describe('lerFormularioDenuncia', () => {
  it('lê slug, avaliação, motivo, texto e o token da verificação humana', () => {
    const r = lerFormularioDenuncia(
      fd({ slug: 'meu-salao', avaliacao_id: 'abc', motivo: 'spam', texto: 'detalhe', 'cf-turnstile-response': 'tok' }),
      '203.0.113.1',
    );
    expect(r.slug).toBe('meu-salao');
    expect(r.entrada).toEqual({ avaliacaoId: 'abc', motivo: 'spam', texto: 'detalhe', ip: '203.0.113.1', tokenHumano: 'tok' });
    expect(r.valores).toEqual({ motivo: 'spam', texto: 'detalhe' });
  });

  it('campos ausentes ou arquivos viram vazio; token vazio vira null; excessos são cortados', () => {
    const f = new FormData();
    f.set('texto', new File(['x'], 'a.txt'));
    const r = lerFormularioDenuncia(f, 'desconhecido');
    expect(r.entrada).toMatchObject({ avaliacaoId: '', motivo: '', texto: '', tokenHumano: null });
    const longo = lerFormularioDenuncia(fd({ texto: 'x'.repeat(5000), slug: 's'.repeat(500), motivo: 'm'.repeat(500) }), 'i');
    expect(longo.entrada.texto?.length).toBe(2000);
    expect(longo.slug).toHaveLength(80);
    expect(longo.entrada.motivo).toHaveLength(40);
  });
});

describe('paraEstadoDenuncia', () => {
  const v = { motivo: 'x', texto: 't' };
  it('cada resultado vira o estado e a mensagem previstos, preservando os valores', () => {
    expect(paraEstadoDenuncia({ resultado: 'invalido', erros: { motivo: 'm' } }, v)).toEqual({ status: 'invalido', mensagem: null, erros: { motivo: 'm' }, valores: v });
    expect(paraEstadoDenuncia({ resultado: 'humano' }, v)).toMatchObject({ status: 'humano', mensagem: MENSAGENS_DENUNCIA.humano, valores: v });
    expect(paraEstadoDenuncia({ resultado: 'limitado' }, v)).toMatchObject({ status: 'limitado', mensagem: MENSAGENS_DENUNCIA.limitado });
  });
});
