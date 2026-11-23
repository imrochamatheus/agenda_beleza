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
const S2 = '44444444-4444-4444-8444-444444444442';
const equipe = criarTenantContext({ usuarioId: USUARIO, papel: 'gestor', salaoId: SALAO, profissionalId: null });
const sistema = contextoDeSistema(SALAO, 'teste');

function entrada(sobre: Partial<EntradaCriarReserva> = {}): EntradaCriarReserva {
  return {
    itens: [{ servicoId: S1, profissionalId: PROF, inicio: new Date('2026-12-01T13:00:00.000Z') }],
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

const liberada = () => ({ permitido: true as const });

function semBanco() {
  expect(repos).not.toHaveBeenCalled();
  expect(emTransacao).not.toHaveBeenCalled();
}

describe('criarReserva: fase pura, sem banco', () => {
  it('campos inválidos → invalido com o campo; vence o consentimento ausente (A-14)', async () => {
    const r = await criarReserva(sistema, entrada({ itens: [], aceites: {} }));
    expect(r).toEqual({ resultado: 'invalido', erros: { itens: MENSAGENS_RESERVA.servicos } });
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
    expect(politica).toHaveBeenCalledWith(equipe, 'agendar', expect.any(Date));
    semBanco();
  });

  it('ids malformados: indisponível sem banco, com os índices dos profissionais malformados', async () => {
    const t = new Date('2026-12-01T13:00:00.000Z');
    const doisItens = [
      { servicoId: S1, profissionalId: PROF, inicio: t },
      { servicoId: S2, profissionalId: 'xyz', inicio: new Date(t.getTime() + 3_600_000) },
    ];
    expect(await criarReserva(sistema, entrada({ itens: doisItens }), { politica: liberada })).toEqual({ resultado: 'profissional_indisponivel', itens: [1] });
    expect(await criarReserva(sistema, entrada({ itens: [{ servicoId: 'nao-uuid', profissionalId: PROF, inicio: t }] }), { politica: liberada })).toEqual({
      resultado: 'servico_indisponivel',
    });
    semBanco();
  });

  it('política padrão (D-038): com o estado ilegível, equipe e público são negados (falha fechada)', async () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const agora = new Date('2026-11-20T12:00:00Z');
    expect(await politicaPadraoDeReserva(equipe, 'agendar', agora)).toEqual({ permitido: false, motivo: 'estado_ilegivel' });
    expect(await politicaPadraoDeReserva(sistema, 'agendar', agora)).toEqual({ permitido: false, motivo: 'estado_ilegivel' });
    aviso.mockRestore();
  });

  it('o log de um desfecho não traz nome, telefone nem chave', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    await criarReserva(sistema, entrada({ itens: [], chaveRequisicao: S1 }));
    const linhas = info.mock.calls.map((c) => String(c[0])).join('\n');
    expect(linhas).toContain('reserva.criar');
    expect(linhas).not.toMatch(/Ana Souza|91234|\+55|mensagensReserva/);
    expect(linhas).not.toContain(S1);
  });

  it('D-029: decidirEncaixe só com modo encaixe e consentimentoOpcional só com equipe (erro de programação)', async () => {
    const decidirEncaixe = vi.fn();
    await expect(criarReserva(equipe, entrada(), { decidirEncaixe })).rejects.toThrow(RangeError);
    await expect(criarReserva(sistema, entrada(), { consentimentoOpcional: true })).rejects.toThrow(RangeError);
    expect(decidirEncaixe).not.toHaveBeenCalled();
    semBanco();
  });

  it('D-029: com consentimentoOpcional, aceite ausente não é consentimento_ausente', async () => {
    // Passa da fase pura e só então tenta o banco (espionado: falha ali), provando que não parou no aceite.
    await expect(criarReserva(equipe, entrada({ aceites: {} }), { consentimentoOpcional: true, politica: liberada })).rejects.toThrow(/não deveria ser chamad/);
  });
});
