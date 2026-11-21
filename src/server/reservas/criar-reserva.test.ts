import { beforeEach, describe, expect, it, vi } from 'vitest';

import { contextoDeSistema, criarPublicoContext, criarTenantContext } from '@/server/tenant/context';
import type { ContextoEscopado } from '@/server/tenant/context';
import { AcessoNegado } from '@/server/tenant/erros';

import { MENSAGENS_RESERVA } from './tipos';
import type { EntradaCriarReserva } from './tipos';

// D-025 CA-11, CA-19, CA-21: os desfechos da fase pura nunca tocam o banco. O módulo de repositórios e
// o de transação são espionados e falham se forem chamados.

const { repos, emTransacao } = vi.hoisted(() => ({
  repos: vi.fn(() => {
    throw new Error('repos() não deveria ser chamado');
  }),
  emTransacao: vi.fn(() => {
    throw new Error('emTransacao não deveria ser chamada');
  }),
}));
vi.mock('@/server/repos', () => ({ repos }));
vi.mock('@/server/repos/transacao', () => ({ emTransacao }));

import { criarReserva, politicaPadraoDeReserva } from './criar-reserva';

const SALAO = '11111111-1111-4111-8111-111111111111';
const USUARIO = '22222222-2222-4222-8222-222222222222';
const PROF = '33333333-3333-4333-8333-333333333333';
const S1 = '44444444-4444-4444-8444-444444444441';
const equipe = criarTenantContext({ usuarioId: USUARIO, papel: 'gestor', salaoId: SALAO, profissionalId: null });
const sistema = contextoDeSistema(SALAO, 'teste');

function entrada(sobre: Partial<EntradaCriarReserva> = {}): EntradaCriarReserva {
  return {
    servicoIds: [S1],
    profissionalId: PROF,
    inicio: new Date('2026-12-01T13:00:00.000Z'),
    cliente: { nome: 'Ana Souza', telefone: '(11) 91234-5678' },
    aceites: { mensagensReserva: true },
    agora: new Date('2026-11-21T12:00:00.000Z'),
    ...sobre,
  };
}

beforeEach(() => {
  repos.mockClear();
  emTransacao.mockClear();
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

function semBanco() {
  expect(repos).not.toHaveBeenCalled();
  expect(emTransacao).not.toHaveBeenCalled();
}

describe('criarReserva: fase pura, sem banco', () => {
  it('campos inválidos → invalido com o campo; vence o consentimento ausente (A-14)', async () => {
    const r = await criarReserva(sistema, entrada({ servicoIds: [], aceites: {} }));
    expect(r).toEqual({ resultado: 'invalido', erros: { servicos: MENSAGENS_RESERVA.servicos } });
    semBanco();
  });

  it.each([
    ['sem aceites', undefined],
    ['objeto vazio', {}],
    ['false', { mensagensReserva: false }],
    ['texto', 'sim'],
    ['null', null],
  ])('consentimento ausente (%s), público e equipe', async (_nome, aceites) => {
    for (const ctx of [sistema, equipe] as ContextoEscopado[]) {
      const r = await criarReserva(ctx, entrada({ aceites }));
      expect(r.resultado).toBe('consentimento_ausente');
    }
    semBanco();
  });

  it('agora inválido, encaixe no público e contexto público lançam RangeError/Error', async () => {
    await expect(criarReserva(sistema, entrada({ agora: new Date(Number.NaN) }))).rejects.toThrow(RangeError);
    await expect(criarReserva(sistema, entrada({ modo: 'encaixe' }))).rejects.toThrow(RangeError);
    const publico = criarPublicoContext(SALAO, 'slug') as unknown as ContextoEscopado;
    await expect(criarReserva(publico, entrada())).rejects.toThrow(Error);
    semBanco();
  });

  it('política negada: equipe → AcessoNegado; público → salao_indisponivel', async () => {
    const politica = vi.fn(() => ({ permitido: false as const, motivo: 'suspenso' }));
    await expect(criarReserva(equipe, entrada(), { politica })).rejects.toBeInstanceOf(AcessoNegado);
    expect(await criarReserva(sistema, entrada(), { politica })).toEqual({ resultado: 'salao_indisponivel' });
    expect(politica).toHaveBeenCalledWith(equipe, 'agendar');
    semBanco();
  });

  it('ids malformados: indisponível sem banco', async () => {
    expect(await criarReserva(sistema, entrada({ profissionalId: 'xyz' }))).toEqual({ resultado: 'profissional_indisponivel' });
    expect(await criarReserva(sistema, entrada({ servicoIds: ['nao-uuid'] }))).toEqual({ resultado: 'servico_indisponivel' });
    semBanco();
  });

  it('política padrão: equipe passa por politicaDeOperacao; sistema sempre pode', async () => {
    expect(await politicaPadraoDeReserva(equipe, 'agendar')).toEqual({ permitido: true });
    expect(await politicaPadraoDeReserva(sistema, 'agendar')).toEqual({ permitido: true });
  });

  it('o log de um desfecho não traz nome, telefone nem chave', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    await criarReserva(sistema, entrada({ servicoIds: [], chaveRequisicao: S1 }));
    const linhas = info.mock.calls.map((c) => String(c[0])).join('\n');
    expect(linhas).toContain('reserva.criar');
    expect(linhas).not.toMatch(/Ana Souza|91234|\+55|mensagensReserva/);
    expect(linhas).not.toContain(S1);
  });
});
