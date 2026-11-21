import { randomUUID } from 'node:crypto';

import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { arquivarDenuncias, restaurarAvaliacao, retirarAvaliacao } from '@/server/denuncias/denuncias.acao';
import { METADADOS_ACAO, metadadosDaAcao } from '@/server/tenant/define-acao';
import { defineAcaoAdmin } from '@/server/tenant/define-acao-admin';
import type { CredenciaisAdmin } from '@/server/tenant/define-acao-admin';

import { credencialDoGestor, credencialDoProfissional, criarSessao, criarSuperAdmin } from '../../support/auth';
import { contarAuditoria } from '../../support/auditoria';
import { criarAvaliacao, linhaDaAvaliacao } from '../../support/denuncias';
import { conectar } from '../../support/sql';
import { salaoNovo } from '../avaliacoes/apoio';

// D-035 CA-9 (R-1): defineAcaoAdmin com sessões REAIS. 401 sem sessão; 403 para salão, profissional e
// admin sem TOTP; só super admin com TOTP executa; nada muda quando recusado.
let c: pg.Client;
beforeAll(async () => {
  c = await conectar();
});
afterAll(async () => {
  await c.end();
});

const MOTIVO = 'Conteúdo ofensivo';
const SEM: CredenciaisAdmin = { admin: null, salao: null };

describe('CA-9: retirar/restaurar/arquivar só para o super admin com TOTP', () => {
  it('401 sem nenhuma sessão, 401 com token desconhecido, e nada muda', async () => {
    const s = await salaoNovo();
    const a = await criarAvaliacao(c, s);
    const aud = await contarAuditoria(c);
    const entradas = { avaliacaoId: a.avaliacaoId, motivo: MOTIVO };
    for (const cred of [SEM, { admin: { token: 'desconhecido' }, salao: null }, { admin: null, salao: { token: 'x' } }] as CredenciaisAdmin[]) {
      expect(await retirarAvaliacao.executar(cred, entradas)).toEqual({ ok: false, erro: 'nao_autenticado', status: 401 });
      expect(await restaurarAvaliacao.executar(cred, entradas)).toEqual({ ok: false, erro: 'nao_autenticado', status: 401 });
      expect(await arquivarDenuncias.executar(cred, { avaliacaoId: a.avaliacaoId })).toEqual({ ok: false, erro: 'nao_autenticado', status: 401 });
    }
    expect((await linhaDaAvaliacao(c, a.avaliacaoId)).retirada_em).toBeNull();
    expect(await contarAuditoria(c)).toBe(aud);
  });

  it('403 real para gestor, profissional (no cookie de salão e no do admin) e para admin sem TOTP', async () => {
    const s = await salaoNovo();
    const a = await criarAvaliacao(c, s);
    const gestor = await credencialDoGestor(s);
    const prof = await credencialDoProfissional(s);
    const semTotp = (await criarSuperAdmin({ totpVerificado: false })).credencial;
    const aud = await contarAuditoria(c);
    const entradas = { avaliacaoId: a.avaliacaoId, motivo: MOTIVO };
    const cenarios: CredenciaisAdmin[] = [
      { admin: null, salao: gestor },
      { admin: null, salao: prof },
      { admin: gestor, salao: gestor },
      { admin: prof, salao: null },
      { admin: semTotp, salao: null },
    ];
    for (const cred of cenarios) {
      expect(await retirarAvaliacao.executar(cred, entradas)).toEqual({ ok: false, erro: 'acesso_negado', status: 403 });
      expect(await restaurarAvaliacao.executar(cred, entradas)).toEqual({ ok: false, erro: 'acesso_negado', status: 403 });
      expect(await arquivarDenuncias.executar(cred, { avaliacaoId: a.avaliacaoId })).toEqual({ ok: false, erro: 'acesso_negado', status: 403 });
    }
    expect((await linhaDaAvaliacao(c, a.avaliacaoId)).retirada_em).toBeNull();
    expect(await contarAuditoria(c)).toBe(aud);
  });

  it('sessão de salão expirada ou revogada não vira 403: é 401', async () => {
    const s = await salaoNovo();
    const exp = await criarSessao(s.gestor.usuarioId, { expiraEm: new Date(Date.now() - 1000) });
    const rev = await criarSessao(s.gestor.usuarioId, { revogadaEm: new Date() });
    for (const salao of [exp.credencial, rev.credencial]) {
      const r = await retirarAvaliacao.executar({ admin: null, salao }, { avaliacaoId: randomUUID(), motivo: MOTIVO });
      expect(r).toEqual({ ok: false, erro: 'nao_autenticado', status: 401 });
    }
  });

  it('super admin com TOTP executa; NaoEncontrado do handler vira 404; recusa de negócio vem dentro de ok', async () => {
    const adm = await criarSuperAdmin({ totpVerificado: true });
    const s = await salaoNovo();
    const a = await criarAvaliacao(c, s);
    const cred: CredenciaisAdmin = { admin: adm.credencial, salao: null };
    expect(await retirarAvaliacao.executar(cred, { avaliacaoId: a.avaliacaoId, motivo: MOTIVO })).toEqual({ ok: true, dados: { resultado: 'ok' } });
    expect(await retirarAvaliacao.executar(cred, { avaliacaoId: a.avaliacaoId, motivo: MOTIVO })).toEqual({
      ok: true, dados: { resultado: 'recusado', motivo: 'estado_atual' },
    });
    expect(await retirarAvaliacao.executar(cred, { avaliacaoId: randomUUID(), motivo: MOTIVO })).toEqual({ ok: false, erro: 'nao_encontrado', status: 404 });
    expect((await linhaDaAvaliacao(c, a.avaliacaoId)).retirada_por).toBe(adm.usuarioId);
    expect(await restaurarAvaliacao.executar(cred, { avaliacaoId: a.avaliacaoId, motivo: MOTIVO })).toEqual({ ok: true, dados: { resultado: 'ok' } });
    expect(await arquivarDenuncias.executar(cred, { avaliacaoId: a.avaliacaoId })).toEqual({ ok: true, dados: { resultado: 'recusado', motivo: 'sem_pendentes' } });
  });

  it('erro que não é de domínio é relançado, não vira resposta', async () => {
    const adm = await criarSuperAdmin({ totpVerificado: true });
    const acao = defineAcaoAdmin(async () => {
      throw new Error('boom');
    });
    await expect(acao.executar({ admin: adm.credencial, salao: null }, null)).rejects.toThrow('boom');
  });
});

describe('metadados e o gestor sem rota de edição', () => {
  it('as três ações declaram só o papel admin (sem capacidade de salão)', () => {
    for (const a of [retirarAvaliacao, restaurarAvaliacao, arquivarDenuncias]) {
      expect(metadadosDaAcao(a)).toEqual({ tipo: 'admin', papeis: ['admin'] });
      expect((a as unknown as Record<typeof METADADOS_ACAO, object>)[METADADOS_ACAO]).toBeDefined();
    }
  });
});
