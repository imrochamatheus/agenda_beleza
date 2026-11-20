import type pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { exigirPermissao } from '@/server/auth/permissoes';
import { desativarProfissional, euTambemAtendo } from '@/server/profissionais/profissionais.acao';
import { listarParaPainel } from '@/server/profissionais/servico';
import { resolverTenant } from '@/server/tenant/sessao';

import { entrarDeVerdade } from '../../support/auth';
import { criarDoisSaloes, criarSalaoCompleto } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { conectar } from '../../support/sql';

import { linhaProfissional, sessoesDe } from './apoio';

// D-013 T-3: "eu também atendo" (RN-3) e o perfil do gestor (RN-7, D-010 RN-14). CA-2 e CA-6.

let c: pg.Client;
let b: SalaoCompleto;

beforeAll(async () => {
  c = await conectar();
  ({ b } = await criarDoisSaloes());
});
afterAll(async () => {
  await c.end();
});
beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

async function perfisDoUsuario(usuarioId: string): Promise<{ id: string; ativo: boolean }[]> {
  const { rows } = await c.query('SELECT id::text AS id, ativo FROM profissional WHERE usuario_id = $1', [usuarioId]);
  return rows;
}

describe('CA-2: eu também atendo', () => {
  it('CA-2: cria exatamente um perfil ativo; nova sessão tem agenda própria; segunda chamada → "já atende"', async () => {
    const s = await criarSalaoCompleto({ gestor: { comPerfil: false, nome: 'Rosa Gestora' } });
    const sessao = await entrarDeVerdade(s.gestor.email);
    const contagemB = await c.query('SELECT count(*)::int AS n FROM profissional WHERE salao_id = $1', [b.salaoId]);

    const r1 = await euTambemAtendo.executar(sessao.credencial, {});
    expect(r1).toEqual({ ok: true, dados: { resultado: 'criado', profissionalId: expect.any(String) } });
    const id = r1.ok ? r1.dados.profissionalId : '';
    expect(await perfisDoUsuario(s.gestor.usuarioId)).toEqual([{ id, ativo: true }]);
    expect(await linhaProfissional(c, id)).toMatchObject({ salao_id: s.salaoId, nome: 'Rosa Gestora', email: null });

    const nova = await entrarDeVerdade(s.gestor.email);
    const ctx = await resolverTenant(nova.credencial);
    expect([ctx.papel, ctx.profissionalId]).toEqual(['gestor', id]);
    expect(() => exigirPermissao(ctx, 'agenda.ver', { profissionalId: id })).not.toThrow();

    expect(await euTambemAtendo.executar(nova.credencial, {})).toEqual({
      ok: true,
      dados: { resultado: 'ja_atende', profissionalId: id },
    });
    expect(await perfisDoUsuario(s.gestor.usuarioId)).toHaveLength(1);
    // CA-10: nunca cria nem altera perfil em B.
    expect((await c.query('SELECT count(*)::int AS n FROM profissional WHERE salao_id = $1', [b.salaoId])).rows).toEqual(
      contagemB.rows,
    );
  });

  it('a lista do painel mostra o perfil do gestor com acesso "Você"', async () => {
    const s = await criarSalaoCompleto();
    const ctx = await resolverTenant((await entrarDeVerdade(s.gestor.email)).credencial);
    const lista = await listarParaPainel(ctx);
    expect(lista.find((p) => p.id === s.gestor.profissionalId)).toMatchObject({
      acesso: 'voce',
      emailLogin: s.gestor.email,
      emailBloqueado: true,
    });
    expect(lista.find((p) => p.id === s.profissional.profissionalId)!.acesso).toBe('com_acesso');
    expect(lista.find((p) => p.id === s.profissionalInativoId)!.acesso).toBe('sem_acesso');
  });
});

describe('CA-6: o gestor desativa o próprio perfil', () => {
  it('CA-6: ativo=false, a sessão do gestor continua; "eu também atendo" reativa o MESMO perfil', async () => {
    const s = await criarSalaoCompleto();
    const id = s.gestor.profissionalId!;
    // Sem reservas futuras confirmadas no perfil do gestor (a da fábrica é do outro profissional).
    const sessao = await entrarDeVerdade(s.gestor.email);

    expect(await desativarProfissional.executar(sessao.credencial, { id })).toEqual({ ok: true, dados: { resultado: 'desativado' } });
    expect((await linhaProfissional(c, id))!.ativo).toBe(false);
    expect((await sessoesDe(c, s.gestor.usuarioId)).map((x) => x.revogada_em)).toEqual([null]);

    const ctx = await resolverTenant(sessao.credencial);
    expect([ctx.papel, ctx.profissionalId]).toEqual(['gestor', id]);
    expect((await listarParaPainel(ctx)).find((p) => p.id === id)).toMatchObject({ ativo: false, acesso: 'voce' });

    expect(await euTambemAtendo.executar(sessao.credencial, {})).toEqual({
      ok: true,
      dados: { resultado: 'reativado', profissionalId: id },
    });
    expect(await perfisDoUsuario(s.gestor.usuarioId)).toEqual([{ id, ativo: true }]);
  });
});
