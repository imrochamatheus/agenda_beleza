import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  contextoDeSistema,
  criarAdminContext,
  criarPublicoContext,
  criarTenantContext,
} from '@/server/tenant/context';
import type { ContextoEscopado } from '@/server/tenant/context';
import { NaoEncontrado } from '@/server/tenant/erros';

import { encerrarPrisma } from './db';
import { repos } from './index';

const SALAO = '0b0c5f6e-4a7d-4f0a-9a43-1f7f3c1e2d10';
const ID = '5d2a9b1c-3e4f-4a5b-8c6d-7e8f9a0b1c2d';
const DADOS = { nome: 'Corte', precoCentavos: 8000, duracaoMin: 45 };
const PERFIL_VAZIO = {
  descricao: null,
  enderecoLogradouro: null,
  enderecoNumero: null,
  enderecoComplemento: null,
  enderecoBairro: null,
  enderecoCidade: null,
  enderecoUf: null,
  enderecoCep: null,
  telefoneE164: null,
  whatsappE164: null,
  instagram: null,
  meiosPagamento: [],
  comodidades: [],
};
const ctx = criarTenantContext({ usuarioId: ID, papel: 'gestor', salaoId: SALAO, profissionalId: null });

// Banco inacessível (porta fechada): os casos abaixo têm de responder ANTES de qualquer consulta;
// uma consulta indevida apareceria como erro de conexão. O comportamento com dados reais (CA-1, CA-2,
// CA-7, CA-8 e CA-14) é da integração (T-5).
describe('repositórios de tenant sem consultar o banco', () => {
  beforeEach(() => {
    vi.stubEnv('DATABASE_URL', 'postgresql://usuario:senha@127.0.0.1:1/z');
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await encerrarPrisma();
  });

  it('ID malformado → NaoEncontrado em toda leitura e mutação por ID (CA-8)', async () => {
    const r = repos();
    for (const id of ['nao-uuid', '', "1' OR '1'='1"]) {
      const chamadas = [
        r.servicos.buscarPorId(ctx, id),
        r.servicos.renomear(ctx, id, 'x'),
        r.servicos.buscarParaPainel(ctx, id),
        r.servicos.listarProfissionaisParaVinculo(ctx, id),
        r.servicos.travarParaAlteracao(ctx, id),
        r.servicos.atualizarDados(ctx, id, DADOS),
        r.servicos.definirAtivo(ctx, id, false),
        r.servicos.substituirVinculosAtivos(ctx, id, []),
        r.profissionais.buscarPorId(ctx, id),
        r.profissionais.renomear(ctx, id, 'x'),
        r.profissionais.buscarParaPainel(ctx, id),
        r.profissionais.travarParaAlteracao(ctx, id),
        r.profissionais.atualizarDados(ctx, id, { nome: 'x', email: null }),
        r.profissionais.aplicarDesativacao(ctx, id, { agora: new Date(), revogarSessoesDe: null }),
        r.profissionais.reativar(ctx, id),
        r.reservas.listarBloqueantesDeDesativacao(ctx, id, new Date()),
        r.clientes.buscarPorId(ctx, id),
        r.clientes.renomear(ctx, id, 'x'),
        r.reservas.buscarPorId(ctx, id),
        r.reservas.atualizarStatus(ctx, id, { de: 'confirmado', para: 'cancelado' }),
        r.jornadas.listarDoProfissional(ctx, id),
        r.jornadas.travarProfissional(ctx, id),
        r.jornadas.buscarProfissional(ctx, id),
        r.jornadas.aplicarDiferenca(ctx, id, { remover: [], inserir: [] }),
        r.reservas.listarConfirmadasQueCruzam(ctx, { de: new Date(0), ate: new Date() }, id, 10),
        r.bloqueios.buscarProfissional(ctx, id),
        r.bloqueios.buscar(ctx, id),
        r.bloqueios.travar(ctx, id),
        r.bloqueios.atualizarPeriodo(ctx, id, { inicio: new Date(0), fim: new Date(), motivo: null }),
        r.bloqueios.remover(ctx, id),
        r.bloqueios.criar(ctx, { profissionalId: id, inicio: new Date(0), fim: new Date(), motivo: null }),
        r.bloqueios.listarVigentes(ctx, new Date(), { profissionalId: id }),
        r.bloqueios.listarNoPeriodo(ctx, { de: new Date(0), ate: new Date() }, { profissionalId: id }),
      ];
      for (const chamada of chamadas) {
        await expect(chamada).rejects.toBeInstanceOf(NaoEncontrado);
      }
    }
  });

  it('contexto admin, publico ou forjado → Error de programação antes da consulta (CA-13)', async () => {
    const r = repos();
    const invalidos = [
      criarAdminContext(ID),
      criarPublicoContext(SALAO, 'studio-a'),
      { tipo: 'tenant', salaoId: 'nao-uuid' },
    ] as unknown as ContextoEscopado[];
    for (const c of invalidos) {
      const chamadas = [
        r.servicos.buscarPorId(c, ID),
        r.servicos.listar(c),
        r.servicos.renomear(c, ID, 'x'),
        r.servicos.criar(c, DADOS),
        r.servicos.listarParaPainel(c),
        r.servicos.buscarParaPainel(c, ID),
        r.servicos.listarProfissionaisParaVinculo(c, ID),
        r.servicos.travarProfissionaisParaVinculo(c, [ID]),
        r.servicos.travarProfissionaisParaVinculo(c, []),
        r.servicos.travarParaAlteracao(c, ID),
        r.servicos.atualizarDados(c, ID, DADOS),
        r.servicos.definirAtivo(c, ID, true),
        r.servicos.substituirVinculosAtivos(c, ID, [ID]),
        r.profissionais.buscarPorId(c, ID),
        r.profissionais.listar(c),
        r.profissionais.renomear(c, ID, 'x'),
        r.profissionais.criar(c, { nome: 'x', email: null }),
        r.profissionais.listarParaPainel(c),
        r.profissionais.buscarParaPainel(c, ID),
        r.profissionais.listarAtivos(c),
        r.profissionais.travarParaAlteracao(c, ID),
        r.profissionais.atualizarDados(c, ID, { nome: 'x', email: null }),
        r.profissionais.aplicarDesativacao(c, ID, { agora: new Date(), revogarSessoesDe: null }),
        r.profissionais.reativar(c, ID),
        r.profissionais.garantirPerfilDoGestor(c as never),
        r.reservas.listarBloqueantesDeDesativacao(c, ID, new Date()),
        r.clientes.buscarPorId(c, ID),
        r.clientes.listar(c),
        r.clientes.renomear(c, ID, 'x'),
        r.reservas.buscarPorId(c, ID),
        r.reservas.listarPorPeriodo(c, { de: new Date(0), ate: new Date() }),
        r.reservas.atualizarStatus(c, ID, { de: 'confirmado', para: 'cancelado' }),
        r.jornadas.listarDoProfissional(c, ID),
        r.jornadas.travarProfissional(c, ID),
        r.jornadas.buscarProfissional(c, ID),
        r.jornadas.aplicarDiferenca(c, ID, { remover: [], inserir: [] }),
        r.reservas.listarConfirmadasQueCruzam(c, { de: new Date(0), ate: new Date() }, null, 10),
        r.reservas.listarConfirmadasQueCruzam(c, { de: new Date(0), ate: new Date() }, ID, 10),
        r.bloqueios.fusoDoSalao(c),
        r.bloqueios.buscarProfissional(c, ID),
        r.bloqueios.listarProfissionais(c),
        r.bloqueios.criar(c, { profissionalId: null, inicio: new Date(0), fim: new Date(), motivo: null }),
        r.bloqueios.buscar(c, ID),
        r.bloqueios.travar(c, ID),
        r.bloqueios.atualizarPeriodo(c, ID, { inicio: new Date(0), fim: new Date(), motivo: null }),
        r.bloqueios.remover(c, ID),
        r.bloqueios.listarVigentes(c, new Date(), { todos: true }),
        r.bloqueios.listarNoPeriodo(c, { de: new Date(0), ate: new Date() }),
        r.saloes.obterConfiguracoes(c),
        r.saloes.listarSlugs(c),
        r.saloes.travar(c),
        r.saloes.slugAtual(c),
        r.saloes.atualizarConfiguracoes(c, {
          nome: 'x',
          fuso: 'America/Sao_Paulo',
          gradeMin: 15,
          antecedenciaMin: 120,
          janelaDias: 60,
          intervaloMin: 0,
        }),
        r.saloes.trocarSlug(c, 'novo-slug'),
        r.saloes.obterPerfil(c),
        r.saloes.atualizarPerfil(c, PERFIL_VAZIO),
        r.funcionamento.travar(c),
        r.funcionamento.listar(c),
        r.funcionamento.aplicarDiferenca(c, { remover: [ID], inserir: [] }),
        r.funcionamento.definirEstado(c, true),
        r.funcionamento.ler(c),
      ];
      for (const chamada of chamadas) {
        await expect(chamada).rejects.toThrow(
          'operação de tenant exige TenantContext ou SistemaContext',
        );
      }
    }
  });

  it('D-014: travarProfissionaisParaVinculo sem nenhum UUID válido → [] sem consulta', async () => {
    const r = repos();
    expect(await r.servicos.travarProfissionaisParaVinculo(ctx, [])).toEqual([]);
    expect(await r.servicos.travarProfissionaisParaVinculo(ctx, ['abc', '', "1' OR '1'='1"])).toEqual([]);
  });

  it('D-015: aplicarDiferenca com listas vazias (ou só ids malformados) não consulta', async () => {
    expect(await repos().jornadas.aplicarDiferenca(ctx, ID, { remover: [], inserir: [] })).toEqual({ removidos: 0, inseridos: 0 });
    expect(await repos().jornadas.aplicarDiferenca(ctx, ID, { remover: ['abc'], inserir: [] })).toEqual({ removidos: 0, inseridos: 0 });
  });

  it('D-020: funcionamento.aplicarDiferenca com listas vazias (ou só ids malformados) não consulta', async () => {
    expect(await repos().funcionamento.aplicarDiferenca(ctx, { remover: [], inserir: [] })).toEqual({ removidos: 0, inseridos: 0 });
    expect(await repos().funcionamento.aplicarDiferenca(ctx, { remover: ['abc'], inserir: [] })).toEqual({ removidos: 0, inseridos: 0 });
  });

  it('D-016: listarConfirmadasQueCruzam com limite inválido → RangeError sem consulta', async () => {
    for (const limite of [0, -1, 1.5, Number.NaN]) {
      await expect(repos().reservas.listarConfirmadasQueCruzam(ctx, { de: new Date(0), ate: new Date() }, null, limite)).rejects.toThrow(
        RangeError,
      );
    }
  });

  it('garantirPerfilDoGestor exige TenantContext: SistemaContext → Error antes da consulta (D-013)', async () => {
    await expect(repos().profissionais.garantirPerfilDoGestor(contextoDeSistema(SALAO, 'worker') as never)).rejects.toThrow(
      'perfil do gestor exige TenantContext',
    );
  });

  it('SistemaContext é aceito (chega à consulta: o erro é de conexão, não de escopo)', async () => {
    const erro = await repos()
      .servicos.buscarPorId(contextoDeSistema(SALAO, 'worker'), ID)
      .catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(Error);
    expect(erro).not.toBeInstanceOf(NaoEncontrado);
    expect((erro as Error).message).not.toContain('exige TenantContext');
  });
});
