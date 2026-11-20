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
      ];
      for (const chamada of chamadas) {
        await expect(chamada).rejects.toThrow(
          'operação de tenant exige TenantContext ou SistemaContext',
        );
      }
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
