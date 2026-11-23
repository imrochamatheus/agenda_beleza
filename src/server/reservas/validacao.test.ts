import { describe, expect, it } from 'vitest';

import { contextoDeSistema, criarPublicoContext, criarTenantContext } from '@/server/tenant/context';
import type { ContextoEscopado } from '@/server/tenant/context';

import { MENSAGENS_RESERVA } from './tipos';
import type { EntradaCriarReserva } from './tipos';
import { validarEntradaReserva } from './validacao';

// CA-19 (D-025) / D-050 §3.5 passo 1: validação pura da entrada com N itens.

const SALAO = '11111111-1111-4111-8111-111111111111';
const USUARIO = '22222222-2222-4222-8222-222222222222';
const PROF = '33333333-3333-4333-8333-333333333333';
const S1 = '44444444-4444-4444-8444-444444444441';
const S2 = '44444444-4444-4444-8444-444444444442';
const PROF2 = '33333333-3333-4333-8333-333333333334';
const T0 = new Date('2026-12-01T13:00:00.000Z');
const T1 = new Date('2026-12-01T14:00:00.000Z');
const itens = (...xs: { servicoId?: unknown; profissionalId?: unknown; inicio?: unknown }[]) => xs as unknown as EntradaCriarReserva['itens'];
const equipe = criarTenantContext({ usuarioId: USUARIO, papel: 'gestor', salaoId: SALAO, profissionalId: null });
const sistema = contextoDeSistema(SALAO, 'teste');

function entrada(sobre: Partial<EntradaCriarReserva> = {}): EntradaCriarReserva {
  return {
    itens: [
      { servicoId: S1, profissionalId: PROF, inicio: T0 },
      { servicoId: S2, profissionalId: PROF2, inicio: T1 },
    ],
    cliente: { nome: 'Ana Souza', telefone: '(11) 91234-5678' },
    aceites: { mensagensReserva: true },
    agora: new Date('2026-11-21T12:00:00.000Z'),
    ...sobre,
  };
}

function invalido(e: EntradaCriarReserva, ctx: ContextoEscopado = sistema) {
  const v = validarEntradaReserva(e, ctx);
  if (v.ok) throw new Error('esperava inválido');
  return v.erros;
}

describe('validarEntradaReserva', () => {
  it('entrada válida: normaliza telefone, nome e chave; modo padrão normal', () => {
    const v = validarEntradaReserva(
      entrada({
        chaveRequisicao: S1.toUpperCase(),
        itens: [
          { servicoId: S1.toUpperCase(), profissionalId: PROF.toUpperCase(), inicio: T0 },
          { servicoId: S2, profissionalId: PROF2, inicio: T1 },
        ],
      }),
      sistema,
    );
    expect(v).toEqual({
      ok: true,
      itens: [
        { servicoId: S1, profissionalId: PROF, inicio: T0 },
        { servicoId: S2, profissionalId: PROF2, inicio: T1 },
      ],
      nome: 'Ana Souza',
      telefoneE164: '+5511912345678',
      chave: S1,
      modo: 'normal',
      malformados: { servicos: false, profissionais: [] },
    });
  });

  it('telefone estrangeiro, curto ou com letras → invalido/telefone', () => {
    for (const telefone of ['+1 202 555 0143', '123', 'abc-defg', '', null, 42]) {
      expect(invalido(entrada({ cliente: { nome: 'Ana', telefone } })).telefone).toBeTruthy();
    }
  });

  it('nome vazio ou longo → invalido/nome', () => {
    expect(invalido(entrada({ cliente: { nome: '  ', telefone: '11912345678' } })).nome).toBeTruthy();
    expect(invalido(entrada({ cliente: { nome: 'A'.repeat(200), telefone: '11912345678' } })).nome).toBeTruthy();
  });

  it('todos os erros juntos, e nenhum campo extra', () => {
    const erros = invalido(
      entrada({
        itens: itens({ servicoId: S1, profissionalId: PROF, inicio: new Date('2026-12-01T13:00:00.500Z') }, { servicoId: S1, profissionalId: PROF, inicio: T1 }),
        chaveRequisicao: 'x',
        cliente: { nome: '', telefone: '1' },
      }),
    );
    expect(Object.keys(erros).sort()).toEqual(['chave', 'itens', 'nome', 'porItem', 'telefone']);
    expect(erros.porItem).toEqual({ 0: { inicio: MENSAGENS_RESERVA.inicio } });
  });

  it('inicio inválido ou sem minuto cheio: erro no índice do item (porItem)', () => {
    for (const ruim of [new Date(Number.NaN), new Date('2026-12-01T14:00:30.000Z'), '2026-12-01T14:00:00Z', undefined]) {
      const erros = invalido(entrada({ itens: itens({ servicoId: S1, profissionalId: PROF, inicio: T0 }, { servicoId: S2, profissionalId: PROF2, inicio: ruim }) }));
      expect(erros).toEqual({ porItem: { 1: { inicio: MENSAGENS_RESERVA.inicio } } });
    }
  });

  it('itens: vazio, serviço repetido (inclusive por caixa), mais de 10, não lista e item sem servicoId texto → invalido/itens', () => {
    const um = (servicoId: unknown) => ({ servicoId, profissionalId: PROF, inicio: T0 });
    expect(invalido(entrada({ itens: [] })).itens).toBe(MENSAGENS_RESERVA.servicos);
    expect(invalido(entrada({ itens: itens(um(S1), um(S1)) })).itens).toBe(MENSAGENS_RESERVA.servicos);
    expect(invalido(entrada({ itens: itens(um(S1), um(S1.toUpperCase())) })).itens).toBe(MENSAGENS_RESERVA.servicos);
    const onze = Array.from({ length: 11 }, (_, i) => um(`44444444-4444-4444-8444-${String(i).padStart(12, '0')}`));
    expect(invalido(entrada({ itens: itens(...onze) })).itens).toBe(MENSAGENS_RESERVA.servicos);
    expect(invalido(entrada({ itens: itens(um(1)) })).itens).toBe(MENSAGENS_RESERVA.servicos);
    expect(invalido(entrada({ itens: itens(null as unknown as object) })).itens).toBe(MENSAGENS_RESERVA.servicos);
    expect(invalido(entrada({ itens: 'x' as unknown as EntradaCriarReserva['itens'] })).itens).toBe(MENSAGENS_RESERVA.servicos);
    const dez = Array.from({ length: 10 }, (_, i) => um(`44444444-4444-4444-8444-${String(i).padStart(12, '0')}`));
    expect(validarEntradaReserva(entrada({ itens: itens(...dez) }), sistema).ok).toBe(true);
  });

  it('chave não UUID → invalido/chave; ausente ou nula → null', () => {
    expect(invalido(entrada({ chaveRequisicao: 'abc' })).chave).toBe(MENSAGENS_RESERVA.chave);
    expect(validarEntradaReserva(entrada({ chaveRequisicao: null }), sistema)).toMatchObject({ ok: true, chave: null });
    expect(validarEntradaReserva(entrada(), sistema)).toMatchObject({ ok: true, chave: null });
  });

  it('ids malformados não são inválidos: marcam indisponibilidade sem banco (A-15), com os índices dos profissionais', () => {
    expect(
      validarEntradaReserva(entrada({ itens: itens({ servicoId: S1, profissionalId: PROF, inicio: T0 }, { servicoId: S2, profissionalId: 'xyz', inicio: T1 }) }), sistema),
    ).toMatchObject({ ok: true, malformados: { servicos: false, profissionais: [1] } });
    expect(
      validarEntradaReserva(entrada({ itens: itens({ servicoId: S1, profissionalId: 7, inicio: T0 }, { servicoId: S2, profissionalId: undefined, inicio: T1 }) }), sistema),
    ).toMatchObject({ ok: true, malformados: { servicos: false, profissionais: [0, 1] }, itens: [{ profissionalId: '' }, { profissionalId: '' }] });
    expect(
      validarEntradaReserva(entrada({ itens: itens({ servicoId: S1, profissionalId: PROF, inicio: T0 }, { servicoId: 'nao-uuid', profissionalId: PROF, inicio: T1 }) }), sistema),
    ).toMatchObject({ ok: true, malformados: { servicos: true, profissionais: [] } });
  });

  it('agora inválido lança RangeError antes de tudo', () => {
    expect(() => validarEntradaReserva(entrada({ agora: new Date(Number.NaN) }), sistema)).toThrow(RangeError);
    expect(() => validarEntradaReserva(entrada({ agora: undefined as unknown as Date }), sistema)).toThrow(RangeError);
  });

  it('modo desconhecido lança RangeError; encaixe no público lança; na equipe é aceito', () => {
    expect(() => validarEntradaReserva(entrada({ modo: 'x' as 'normal' }), equipe)).toThrow(RangeError);
    expect(() => validarEntradaReserva(entrada({ modo: 'encaixe' }), sistema)).toThrow(RangeError);
    expect(validarEntradaReserva(entrada({ modo: 'encaixe' }), equipe)).toMatchObject({ ok: true, modo: 'encaixe' });
  });

  it('contexto que não é de tenant nem de sistema lança Error', () => {
    const publico = criarPublicoContext(SALAO, 'slug') as unknown as ContextoEscopado;
    expect(() => validarEntradaReserva(entrada(), publico)).toThrow(Error);
  });
});
