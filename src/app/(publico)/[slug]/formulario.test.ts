import { describe, expect, it } from 'vitest';

import { MENSAGENS_RESERVA_PUBLICA } from '@/server/reserva-publica/tipos';
import type { ResultadoReservaPublica } from '@/server/reserva-publica/tipos';

import { destinoDoRedirecionamento, lerSelecaoDoFormulario, lerFormulario, paraEstado } from './formulario';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const H = '2026-12-01T12:00:00.000Z';
const CHAVE = '33333333-3333-4333-8333-333333333333';

function fd(campos: Record<string, string | string[]>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
}
const COMPLETO = { slug: 'bela', s: [A, B], p: 'qualquer', data: '2026-12-01', profissionalId: A, inicio: H, chave: CHAVE, nome: 'Maria', telefone: '(11) 98765-4321', consentimento_mensagens: 'on' };
const VALORES = { nome: 'Maria', telefone: '(11) 98765-4321', mensagensReserva: true, conviteAvaliacao: false };

describe('lerFormulario (CA-10)', () => {
  it('lê os campos, a ordem dos serviços e o consentimento estrito', () => {
    const { entrada, valores } = lerFormulario(fd(COMPLETO), '203.0.113.9');
    expect(entrada).toMatchObject({ slug: 'bela', servicoIds: [A, B], profissionalId: A, inicio: H, chaveRequisicao: CHAVE, nome: 'Maria' });
    expect(entrada.aceites).toEqual({ mensagensReserva: 'on', conviteAvaliacao: null });
    expect(valores).toEqual(VALORES);
  });

  it('ausentes viram texto vazio; o eco é cortado nos tetos', () => {
    const { entrada, valores } = lerFormulario(fd({ nome: 'x'.repeat(500), telefone: '9'.repeat(500) }), '203.0.113.9');
    expect(entrada.servicoIds).toEqual([]);
    expect(entrada.slug).toBe('');
    expect(valores.nome).toHaveLength(100);
    expect(valores.telefone).toHaveLength(30);
    expect(valores.mensagensReserva).toBe(false);
  });

  it('arquivos no lugar de texto são ignorados', () => {
    const f = new FormData();
    f.append('nome', new Blob(['a']), 'a.txt');
    expect(lerFormulario(f, '203.0.113.9').entrada.nome).toBe('');
  });
});

describe('destinoDoRedirecionamento', () => {
  const voltar = (passo: 'servicos' | 'profissional' | 'horario'): ResultadoReservaPublica => ({ resultado: 'voltar', passo, aviso: 'horario_indisponivel' });

  it('horário: volta ao dia com o aviso (sem o horário)', () => {
    expect(destinoDoRedirecionamento(fd(COMPLETO), voltar('horario'))).toBe(
      `/bela?s=${A}&s=${B}&p=qualquer&data=2026-12-01&aviso=horario_indisponivel`,
    );
  });

  it('profissional e serviços: voltam ao passo com o aviso', () => {
    expect(destinoDoRedirecionamento(fd(COMPLETO), voltar('profissional'))).toBe(`/bela?s=${A}&s=${B}&aviso=horario_indisponivel`);
    expect(destinoDoRedirecionamento(fd(COMPLETO), voltar('servicos'))).toBe('/bela?aviso=horario_indisponivel');
  });

  it('campos adulterados degradam para o passo anterior, e slug inválido para o início', () => {
    expect(destinoDoRedirecionamento(fd({ ...COMPLETO, s: ['x'] }), voltar('horario'))).toBe('/bela?aviso=horario_indisponivel');
    expect(destinoDoRedirecionamento(fd({ ...COMPLETO, p: 'x' }), voltar('horario'))).toBe(`/bela?s=${A}&s=${B}&aviso=horario_indisponivel`);
    expect(destinoDoRedirecionamento(fd({ ...COMPLETO, data: 'x' }), voltar('horario'))).toBe(`/bela?s=${A}&s=${B}&p=qualquer&aviso=horario_indisponivel`);
    expect(destinoDoRedirecionamento(fd({ ...COMPLETO, slug: 'Mau/../' }), voltar('servicos'))).toBe('/?aviso=horario_indisponivel');
  });

  it('slug_mudou: vai ao slug novo preservando o fluxo inteiro', () => {
    expect(destinoDoRedirecionamento(fd(COMPLETO), { resultado: 'slug_mudou', slugAtual: 'novo' })).toBe(
      `/novo?s=${A}&s=${B}&p=qualquer&data=2026-12-01&h=2026-12-01T12%3A00%3A00.000Z`,
    );
    expect(destinoDoRedirecionamento(fd({ slug: 'bela' }), { resultado: 'slug_mudou', slugAtual: 'novo' })).toBe('/novo');
  });

  it('os demais resultados ficam na resposta', () => {
    expect(destinoDoRedirecionamento(fd(COMPLETO), { resultado: 'indisponivel' })).toBeNull();
    expect(destinoDoRedirecionamento(fd(COMPLETO), { resultado: 'recusado', mensagem: 'x' })).toBeNull();
  });
});

describe('paraEstado', () => {
  const resumo = { servicos: [], profissionalNome: 'Ana', inicioIso: H, fuso: 'America/Sao_Paulo', totalCentavos: 0, duracaoTotalMin: 0 };

  it('confirmada (e repetida) mostra o resumo com a mesma chave', () => {
    const e = paraEstado({ resultado: 'confirmada', resumo, repetida: true }, VALORES, CHAVE);
    expect(e).toMatchObject({ status: 'confirmada', repetida: true, chave: CHAVE, resumo });
  });

  it('indisponível e recusado', () => {
    expect(paraEstado({ resultado: 'indisponivel' }, VALORES, CHAVE).status).toBe('indisponivel');
    expect(paraEstado({ resultado: 'recusado', mensagem: 'Não.' }, VALORES, CHAVE)).toMatchObject({ status: 'editando', mensagem: 'Não.' });
  });

  it('inválido: erros por campo e valores preservados; erro geral só sem erro de campo', () => {
    const e = paraEstado({ resultado: 'invalido', erros: { nome: 'N', telefone: 'T', mensagensReserva: 'C' } }, VALORES, CHAVE);
    expect(e).toMatchObject({ status: 'editando', erros: { nome: 'N', telefone: 'T', mensagensReserva: 'C' }, valores: VALORES, mensagem: null });
    expect(paraEstado({ resultado: 'invalido', erros: { servicos: 'S' } }, VALORES, CHAVE).mensagem).toBe('S');
    expect(paraEstado({ resultado: 'invalido', erros: {} }, VALORES, CHAVE).mensagem).toBe(MENSAGENS_RESERVA_PUBLICA.generico);
  });

  it('voltar/slug_mudou não deveriam chegar aqui: mensagem genérica sem 500', () => {
    expect(paraEstado({ resultado: 'voltar', passo: 'horario', aviso: 'horario_indisponivel' }, VALORES, CHAVE).mensagem).toBe(
      MENSAGENS_RESERVA_PUBLICA.recusada,
    );
  });
});

describe('lerSelecaoDoFormulario (D-036 DEF-1)', () => {
  it('lê serviços, profissional e dia; seleção incompleta ou inválida devolve null', () => {
    expect(lerSelecaoDoFormulario(fd(COMPLETO))).toEqual({ s: [A, B], p: 'qualquer', data: '2026-12-01' });
    expect(lerSelecaoDoFormulario(fd({ ...COMPLETO, data: 'x' }))).toBeNull();
    expect(lerSelecaoDoFormulario(fd({ ...COMPLETO, p: 'x' }))).toBeNull();
    expect(lerSelecaoDoFormulario(fd({ ...COMPLETO, s: ['x'] }))).toBeNull();
  });
});

