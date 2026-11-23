import { beforeAll, describe, expect, it } from 'vitest';

import { repos } from '@/server/repos';
import { listarServicosPublicos, resolverSalaoPorSlug } from '@/server/repos/publico';
import { contextoDeSistema } from '@/server/tenant/context';
import type { AdminContext, PublicoContext, TenantContext } from '@/server/tenant/context';
import { AcessoNegado, NaoAutenticado, NaoEncontrado } from '@/server/tenant/erros';
import { resolverAdmin, resolverTenant } from '@/server/tenant/sessao';

import { credencialDoGestor, credencialDoProfissional, criarSessao, criarSuperAdmin } from '../../support/auth';
import { criarDoisSaloes } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';

// CA-13 (RN-4, RN-11): AdminContext só com super_admin + TOTP verificado; um usuário de salão nunca o
// obtém. AdminContext e PublicoContext não são aceitos pelos repositórios de tenant: no TIPO
// (@ts-expect-error, conferido pelo `npm run typecheck`) e em tempo de execução (exigirEscopo).
// Todos os contextos vêm das fábricas reais (sessão, slug, contextoDeSistema), nunca de literal com `as`.

let a: SalaoCompleto;
let b: SalaoCompleto;

beforeAll(async () => {
  ({ a, b } = await criarDoisSaloes());
});

describe('CA-13: obtenção do AdminContext', () => {
  it('CA-13: super_admin com sessão sem totp_verificado_em → recusado (AcessoNegado)', async () => {
    const admin = await criarSuperAdmin({ totpVerificado: false });
    const e = await resolverAdmin(admin.credencial).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(AcessoNegado);
    expect((e as AcessoNegado).motivo).toBe('TOTP não verificado');
  });

  it('CA-13: super_admin com TOTP verificado → AdminContext', async () => {
    const admin = await criarSuperAdmin({ totpVerificado: true });
    const ctx = await resolverAdmin(admin.credencial);
    expect({ ...ctx }).toEqual({ tipo: 'admin', usuarioId: admin.usuarioId });
    expect(Object.isFrozen(ctx)).toBe(true);
  });

  it('CA-13: gestor e profissional nunca obtêm AdminContext, mesmo com TOTP na sessão', async () => {
    for (const credencial of [
      await credencialDoGestor(a, { totpVerificadoEm: new Date() }),
      await credencialDoProfissional(a, { totpVerificadoEm: new Date() }),
    ]) {
      const e = await resolverAdmin(credencial).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(AcessoNegado);
      expect((e as AcessoNegado).motivo).toBe('papel não é super_admin');
    }
  });

  it('CA-13: sessão de super_admin inválida → NaoAutenticado (antes de olhar o papel)', async () => {
    const admin = await criarSuperAdmin({ totpVerificado: true });
    const expirada = await criarSessao(admin.usuarioId, { totpVerificadoEm: new Date(), expiraEm: new Date(Date.now() - 1) });
    await expect(resolverAdmin(expirada.credencial)).rejects.toBeInstanceOf(NaoAutenticado);
    await expect(resolverAdmin(null)).rejects.toBeInstanceOf(NaoAutenticado);
    await expect(resolverAdmin({ token: 'desconhecido' })).rejects.toBeInstanceOf(NaoAutenticado);
  });

  it('CA-13: super_admin não obtém TenantContext', async () => {
    const admin = await criarSuperAdmin({ totpVerificado: true });
    await expect(resolverTenant(admin.credencial)).rejects.toBeInstanceOf(AcessoNegado);
  });
});

describe('CA-13: repositórios de tenant recusam AdminContext e PublicoContext', () => {
  it('CA-13: AdminContext real passado a um repositório de tenant → erro de tipo e Error em execução', async () => {
    const admin: AdminContext = await resolverAdmin((await criarSuperAdmin({ totpVerificado: true })).credencial);
    const r = repos();
    // @ts-expect-error AdminContext não é ContextoEscopado (CA-13: o typecheck falha se isto compilar).
    const p1 = r.servicos.buscarPorId(admin, a.servicos.ativos[0]);
    // @ts-expect-error AdminContext não é aceito em listagens de tenant.
    const p2 = r.clientes.listar(admin);
    // @ts-expect-error AdminContext não é aceito em mutações de tenant.
    const p3 = r.reservas.criarItens(admin, a.reserva.id, [
      {
        servicoId: a.servicos.inativoId,
        profissionalId: a.profissional.profissionalId,
        ordem: 9,
        inicio: a.reserva.fim,
        fim: new Date(a.reserva.fim.getTime() + 30 * 60_000),
        ocupadoAte: new Date(a.reserva.fim.getTime() + 30 * 60_000),
        precoCentavos: 1,
        duracaoMin: 30,
        encaixe: false,
      },
    ]);
    for (const p of [p1, p2, p3]) {
      const e = await p.catch((x: unknown) => x);
      expect(e).toBeInstanceOf(Error);
      expect(e).not.toBeInstanceOf(NaoEncontrado);
      expect((e as Error).message).toBe('operação de tenant exige TenantContext ou SistemaContext');
    }
    // A reserva não mudou (nenhum item novo).
    const ctxA = await resolverTenant(await credencialDoGestor(a));
    const reserva = await r.reservas.buscarPorId(ctxA, a.reserva.id);
    expect(reserva.status).toBe('confirmado');
    expect(reserva.itens.map((i) => i.id)).toEqual(a.reserva.itemIds);
  });

  it('CA-13: PublicoContext real passado a um repositório de tenant → erro de tipo e Error em execução', async () => {
    const { contexto }: { contexto: PublicoContext } = await resolverSalaoPorSlug(a.slugAtual);
    const r = repos();
    // @ts-expect-error PublicoContext não é ContextoEscopado (CA-13).
    const p1 = r.profissionais.buscarPorId(contexto, a.profissional.profissionalId);
    // @ts-expect-error PublicoContext não é aceito em mutações de tenant.
    const p2 = r.servicos.renomear(contexto, a.servicos.ativos[0], 'x');
    for (const p of [p1, p2]) {
      await expect(p).rejects.toThrow('operação de tenant exige TenantContext ou SistemaContext');
    }
  });

  it('CA-13: TenantContext real não é aceito pelas leituras públicas (tipo e execução)', async () => {
    const ctx: TenantContext = await resolverTenant(await credencialDoGestor(a));
    // @ts-expect-error TenantContext não é PublicoContext.
    await expect(listarServicosPublicos(ctx)).rejects.toThrow('leitura pública exige PublicoContext');
  });

  it('CA-13: SistemaContext é aceito e continua escopado ao salão informado', async () => {
    const sistema = contextoDeSistema(a.salaoId, 'teste-ca13');
    const r = repos();
    expect((await r.servicos.buscarPorId(sistema, a.servicos.ativos[0])).id).toBe(a.servicos.ativos[0]);
    expect((await r.reservas.buscarPorId(sistema, a.reserva.id)).itens).toHaveLength(2);
    await expect(r.servicos.buscarPorId(sistema, b.servicos.ativos[0])).rejects.toBeInstanceOf(NaoEncontrado);
    expect(new Set((await r.clientes.listar(sistema)).map((x) => x.id))).toEqual(
      new Set([a.clientes.ativaId, a.clientes.anonimizadaId]),
    );
  });

  it('CA-13: a cliente anonimizada é devolvida à equipe com nome e telefone nulos (RN-16)', async () => {
    const ctx = await resolverTenant(await credencialDoGestor(a));
    const anon = await repos().clientes.buscarPorId(ctx, a.clientes.anonimizadaId);
    expect(anon).toMatchObject({ id: a.clientes.anonimizadaId, nome: null, telefoneE164: null });
    expect(anon.anonimizadaEm).toBeInstanceOf(Date);
  });
});
