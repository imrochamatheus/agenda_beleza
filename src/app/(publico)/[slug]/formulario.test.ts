import { describe, expect, it } from 'vitest';

import { MENSAGENS_PROTECAO } from '@/server/protecao/tipos';
import { valorDoItem } from '@/server/reserva-publica/passos';
import { MENSAGENS_PASSO, MENSAGENS_RESERVA_PUBLICA } from '@/server/reserva-publica/tipos';
import type { ItemDaReescolha, ResultadoReservaPublica, ResumoConfirmacao } from '@/server/reserva-publica/tipos';

import { estadoInicialReserva } from './estado';
import type { ReescolhaNoEstado } from './estado';
import {
  comReescolha,
  destinoDoRedirecionamento,
  lerFormulario,
  lerReabrir,
  mensagemDaReescolha,
  paraEstado,
  parametrosDoFormulario,
  selecaoDaReescolha,
} from './formulario';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const ANA = '33333333-3333-4333-8333-333333333333';
const BIA = '55555555-5555-4555-8555-555555555555';
const H0 = '2026-12-01T12:00:00.000Z';
const H1 = '2026-12-01T13:00:00.000Z';
const CHAVE = '44444444-4444-4444-8444-444444444444';
const V0 = valorDoItem(ANA, H0);
const V1 = valorDoItem(BIA, H1);

function fd(campos: Record<string, string | string[]>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
}
const COMPLETO = {
  slug: 'bela',
  s: [A, B],
  data: '2026-12-01',
  h0: V0,
  h1: V1,
  chave: CHAVE,
  nome: 'Maria',
  telefone: '(11) 98765-4321',
  consentimento_mensagens: 'on',
};
const VALORES = { nome: 'Maria', telefone: '(11) 98765-4321', mensagensReserva: true, conviteAvaliacao: false };
const enc = encodeURIComponent;

describe('lerFormulario (CA-10, D-050 §3.10)', () => {
  it('lê os serviços na ordem, um item por serviço de h<k>, a chave e o consentimento estrito', () => {
    const { entrada, valores } = lerFormulario(fd(COMPLETO), '203.0.113.9');
    expect(entrada).toMatchObject({ slug: 'bela', servicoIds: [A, B], chaveRequisicao: CHAVE, nome: 'Maria', ip: '203.0.113.9' });
    expect(entrada.itens).toEqual([
      { servicoId: A, profissionalId: ANA, inicio: H0 },
      { servicoId: B, profissionalId: BIA, inicio: H1 },
    ]);
    expect(entrada.aceites).toEqual({ mensagensReserva: 'on', conviteAvaliacao: null });
    expect(valores).toEqual(VALORES);
  });

  it('h<k> ausente ou malformado vira item vazio (o serviço o recusa); ausentes viram texto vazio; eco cortado', () => {
    const { entrada } = lerFormulario(fd({ ...COMPLETO, h1: 'lixo' }), 'x');
    expect(entrada.itens[1]).toEqual({ servicoId: B, profissionalId: '', inicio: '' });
    const vazio = lerFormulario(fd({ nome: 'x'.repeat(500), telefone: '9'.repeat(500) }), 'x');
    expect(vazio.entrada.servicoIds).toEqual([]);
    expect(vazio.entrada.itens).toEqual([]);
    expect(vazio.entrada.slug).toBe('');
    expect(vazio.entrada.tokenHumano).toBeNull();
    expect(vazio.valores.nome).toHaveLength(100);
    expect(vazio.valores.telefone).toHaveLength(30);
  });

  it('arquivos no lugar de texto são ignorados', () => {
    const f = new FormData();
    f.append('nome', new Blob(['a']), 'a.txt');
    f.append('h0', new Blob(['a']), 'a.txt');
    expect(lerFormulario(f, 'x').entrada.nome).toBe('');
    expect(parametrosDoFormulario(f)).toEqual({});
  });
});

describe('parametrosDoFormulario, lerReabrir, selecaoDaReescolha', () => {
  it('repetidos viram lista, únicos viram texto', () => {
    expect(parametrosDoFormulario(fd({ s: [A, B], data: '2026-12-01' }))).toEqual({ s: [A, B], data: '2026-12-01' });
  });

  it('reabrir: só índices 0..9, sem repetição', () => {
    expect(lerReabrir(fd({ reabrir: ['1', '0', '1', '10', '-1', 'x', '01'] }))).toEqual([1, 0]);
    expect(lerReabrir(fd({}))).toEqual([]);
  });

  it('seleção completa vira a entrada da reescolha; incompleta, null', () => {
    expect(selecaoDaReescolha(fd(COMPLETO))).toEqual({
      s: [A, B],
      data: '2026-12-01',
      itens: [
        { profissionalId: ANA, inicio: H0 },
        { profissionalId: BIA, inicio: H1 },
      ],
    });
    expect(selecaoDaReescolha(fd({ ...COMPLETO, h1: 'x' }))).toBeNull();
    expect(selecaoDaReescolha(fd({ ...COMPLETO, data: 'x' }))).toBeNull();
  });
});

describe('destinoDoRedirecionamento', () => {
  it('voltar ao serviço k: a URL mantém os outros itens e tira o do índice', () => {
    const r: ResultadoReservaPublica = { resultado: 'voltar', passo: 'servico', indice: 1, aviso: 'profissional_indisponivel' };
    expect(destinoDoRedirecionamento(fd(COMPLETO), r)).toBe(
      `/bela?s=${A}&s=${B}&data=2026-12-01&h0=${enc(V0)}&aviso=profissional_indisponivel`,
    );
  });

  it('voltar aos serviços: só o aviso', () => {
    expect(destinoDoRedirecionamento(fd(COMPLETO), { resultado: 'voltar', passo: 'servicos', aviso: 'servico_indisponivel' })).toBe(
      '/bela?aviso=servico_indisponivel',
    );
  });

  it('campos adulterados degradam para o passo anterior, e slug inválido para o início', () => {
    const r: ResultadoReservaPublica = { resultado: 'voltar', passo: 'servico', indice: 0, aviso: 'horario_indisponivel' };
    expect(destinoDoRedirecionamento(fd({ ...COMPLETO, s: ['x'] }), r)).toBe('/bela?aviso=horario_indisponivel');
    expect(destinoDoRedirecionamento(fd({ ...COMPLETO, h1: 'x' }), r)).toBe(`/bela?s=${A}&s=${B}&aviso=horario_indisponivel`);
    expect(destinoDoRedirecionamento(fd({ ...COMPLETO, slug: 'Mau/../' }), r)).toBe(`/?s=${A}&s=${B}&data=2026-12-01&h1=${enc(V1)}&aviso=horario_indisponivel`);
  });

  it('slug_mudou: vai ao slug novo preservando serviços, dia e itens', () => {
    expect(destinoDoRedirecionamento(fd(COMPLETO), { resultado: 'slug_mudou', slugAtual: 'novo' })).toBe(
      `/novo?s=${A}&s=${B}&data=2026-12-01&h0=${enc(V0)}&h1=${enc(V1)}`,
    );
    expect(destinoDoRedirecionamento(fd({ ...COMPLETO, h0: 'x' }), { resultado: 'slug_mudou', slugAtual: 'novo' })).toBe(`/novo?s=${A}&s=${B}`);
    expect(destinoDoRedirecionamento(fd({ slug: 'bela' }), { resultado: 'slug_mudou', slugAtual: 'novo' })).toBe('/novo');
  });

  it('os demais resultados ficam na resposta', () => {
    expect(destinoDoRedirecionamento(fd(COMPLETO), { resultado: 'indisponivel' })).toBeNull();
    expect(destinoDoRedirecionamento(fd(COMPLETO), { resultado: 'reescolher', itens: [0] })).toBeNull();
  });
});

describe('paraEstado', () => {
  const resumo: ResumoConfirmacao = { fuso: 'America/Sao_Paulo', data: '2026-12-01', itens: [], totalCentavos: 0 };

  it('confirmada (e repetida) mostra o resumo com a mesma chave', () => {
    expect(paraEstado({ resultado: 'confirmada', resumo, repetida: true }, VALORES, CHAVE)).toMatchObject({
      status: 'confirmada',
      repetida: true,
      chave: CHAVE,
      resumo,
    });
  });

  it('indisponível, recusado e limitado', () => {
    expect(paraEstado({ resultado: 'indisponivel' }, VALORES, CHAVE).status).toBe('indisponivel');
    expect(paraEstado({ resultado: 'recusado', mensagem: 'Não.' }, VALORES, CHAVE)).toMatchObject({ status: 'editando', mensagem: 'Não.' });
    expect(paraEstado({ resultado: 'limitado', mensagem: 'L' }, VALORES, CHAVE).mensagem).toBe('L');
  });

  it('inválido: erros por campo e valores preservados; erro geral (itens/chave) só sem erro de campo', () => {
    const e = paraEstado({ resultado: 'invalido', erros: { nome: 'N', telefone: 'T', mensagensReserva: 'C' } }, VALORES, CHAVE);
    expect(e).toMatchObject({ status: 'editando', erros: { nome: 'N', telefone: 'T', mensagensReserva: 'C' }, valores: VALORES, mensagem: null });
    expect(paraEstado({ resultado: 'invalido', erros: { itens: 'I', porItem: { 0: { inicio: 'x' } } } }, VALORES, CHAVE).mensagem).toBe('I');
    expect(paraEstado({ resultado: 'invalido', erros: { chave: 'K' } }, VALORES, CHAVE).mensagem).toBe('K');
    expect(paraEstado({ resultado: 'invalido', erros: {} }, VALORES, CHAVE).mensagem).toBe(MENSAGENS_RESERVA_PUBLICA.generico);
  });

  it('voltar/slug_mudou/reescolher não deveriam chegar aqui: mensagem genérica sem 500', () => {
    expect(paraEstado({ resultado: 'reescolher', itens: [] }, VALORES, CHAVE).mensagem).toBe(MENSAGENS_RESERVA_PUBLICA.recusada);
  });
});

describe('reescolha (CA-10, web-design §5.6)', () => {
  const item = (o: Partial<ItemDaReescolha>): ItemDaReescolha => ({
    indice: 1,
    servicoId: B,
    servicoNome: 'Hidratação',
    horarioAnteriorIso: H1,
    profissionalAnteriorNome: 'Bia',
    profissionais: [{ id: BIA, nome: 'Bia', horarios: ['2026-12-01T14:00:00.000Z'] }],
    caiu: true,
    preSelecionado: null,
    ...o,
  });
  const r = (itens: ItemDaReescolha[]): ReescolhaNoEstado => ({
    resultado: 'reescolher',
    fuso: 'America/Sao_Paulo',
    data: '2026-12-01',
    mantidos: [],
    itens,
    consulta: { s: [A, B], data: '2026-12-01', h: [V0, V1] },
  });
  const base = { ...estadoInicialReserva(CHAVE), valores: VALORES };

  it('um item: nomeia o horário (no fuso do salão), o serviço e o profissional', () => {
    expect(mensagemDaReescolha(r([item({})]))).toBe(MENSAGENS_PASSO.reescolhaUm('10:00', 'Hidratação', 'Bia'));
    expect(mensagemDaReescolha(r([item({ profissionalAnteriorNome: null })]))).toContain('O horário das 10:00 de Hidratação acabou');
  });

  it('vários: lista "Serviço (hora)"; itens só reabertos não entram; nenhum caído → null', () => {
    const varios = r([item({ indice: 0, servicoNome: 'Escova', horarioAnteriorIso: H0 }), item({})]);
    expect(mensagemDaReescolha(varios)).toBe(MENSAGENS_PASSO.reescolhaVarios('Escova (09:00) e Hidratação (10:00)'));
    expect(mensagemDaReescolha(r([item({ caiu: false })]))).toBeNull();
  });

  it('comReescolha: horário caído → horario_indisponivel com o aviso; reaberto mantém erros e status', () => {
    const caiu = comReescolha(base, r([item({})]));
    expect(caiu).toMatchObject({ status: 'horario_indisponivel', valores: VALORES, chave: CHAVE, reescolha: { itens: [{ indice: 1 }] } });
    expect(caiu.mensagem).toContain('acabou de ser reservado');
    const comErro = { ...base, erros: { nome: 'N' } };
    expect(comReescolha(comErro, r([item({ caiu: false })]))).toMatchObject({ status: 'editando', erros: { nome: 'N' }, mensagem: null });
  });

  it('comReescolha: sem queda → aviso genérico no passo de dados; limitado → mensagem de limite', () => {
    expect(comReescolha(base, { resultado: 'sem_queda' })).toMatchObject({ status: 'editando', mensagem: MENSAGENS_PASSO.reescolhaSemQueda, reescolha: null });
    expect(comReescolha({ ...base, mensagem: 'M' }, { resultado: 'sem_queda' }).mensagem).toBe('M');
    expect(comReescolha(base, { resultado: 'limitado' })).toMatchObject({ mensagem: MENSAGENS_PROTECAO.limitado, reescolha: null });
  });
});
