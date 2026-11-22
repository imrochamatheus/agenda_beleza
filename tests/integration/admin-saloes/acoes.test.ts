import { randomUUID } from 'node:crypto';

import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { editarSalao, estenderTeste, reativarSalao, suspenderSalao } from '@/server/admin/saloes.acao';
import { entradaIgual } from '../../support/admin-saloes';
import { encerrarPrisma } from '@/server/repos/db';
import { METADADOS_ACAO, metadadosDaAcao } from '@/server/tenant/define-acao';
import type { CredenciaisAdmin } from '@/server/tenant/define-acao-admin';
import { lerSalao } from '@/server/admin/saloes';

import { adminDeTeste, salaoComAssinatura, salaoEmTeste, salaoNoBanco } from '../../support/admin-saloes';
import { contarAuditoria } from '../../support/auditoria';
import { credencialDoGestor, credencialDoProfissional, criarSessao, criarSuperAdmin } from '../../support/auth';
import { conectar } from '../../support/sql';

// D-044 CA-10 (RN-1): defineAcaoAdmin com sessões REAIS em TODAS as ações. 401 sem sessão; 403 para gestor,
// profissional e admin sem TOTP; só super admin com TOTP executa; nada muda quando recusado.
let c: pg.Client;
beforeAll(async () => {
  c = await conectar();
});
afterAll(async () => {
  await c.end();
  await encerrarPrisma();
});

const SEM: CredenciaisAdmin = { admin: null, salao: null };

function chamadas(salaoId: string, fimEsperado = new Date().toISOString()) {
  return {
    editar: (cr: CredenciaisAdmin) => editarSalao.executar(cr, { salaoId, nome: 'Nome invasor', slug: 'invasor', fuso: 'America/Sao_Paulo', grade: '15', antecedencia: '2', janela: '60', intervalo: '0', gestorNome: 'Invasor', gestorEmail: 'invasor@exemplo.com.br' }),
    suspender: (cr: CredenciaisAdmin) => suspenderSalao.executar(cr, { salaoId, motivo: 'Motivo qualquer', etapa: 'confirmar' }),
    reativar: (cr: CredenciaisAdmin) => reativarSalao.executar(cr, { salaoId }),
    estender: (cr: CredenciaisAdmin) => estenderTeste.executar(cr, { salaoId, dias: '5', testeFimEmEsperado: fimEsperado, etapa: 'confirmar' }),
  };
}

describe('CA-10: ninguém além do super admin com TOTP', () => {
  it('as quatro ações são defineAcaoAdmin (metadado de admin)', () => {
    for (const a of [editarSalao, suspenderSalao, reativarSalao, estenderTeste]) {
      expect(metadadosDaAcao(a as never)).toEqual({ tipo: 'admin', papeis: ['admin'] });
      expect((a as unknown as Record<symbol, unknown>)[METADADOS_ACAO]).toEqual({ tipo: 'admin', papeis: ['admin'] });
    }
  });

  it('401 sem sessão ou com token desconhecido, e nada muda', async () => {
    const s = await salaoEmTeste();
    const aud = await contarAuditoria(c);
    const ch = chamadas(s.salaoId);
    for (const cred of [SEM, { admin: { token: 'desconhecido' }, salao: null }, { admin: null, salao: { token: 'x' } }] as CredenciaisAdmin[]) {
      for (const f of Object.values(ch)) expect(await f(cred)).toEqual({ ok: false, erro: 'nao_autenticado', status: 401 });
    }
    expect((await salaoNoBanco(c, s.salaoId)).suspenso_manual_em).toBeNull();
    expect((await salaoNoBanco(c, s.salaoId)).nome).toBe(s.nome);
    expect(await contarAuditoria(c)).toBe(aud);
  });

  it('403 real para gestor, profissional (nos dois cookies) e admin sem TOTP, e nada muda', async () => {
    const s = await salaoEmTeste();
    const gestor = await credencialDoGestor(s);
    const prof = await credencialDoProfissional(s);
    const semTotp = (await criarSuperAdmin({ totpVerificado: false })).credencial;
    const aud = await contarAuditoria(c);
    const ch = chamadas(s.salaoId);
    const cenarios: CredenciaisAdmin[] = [
      { admin: null, salao: gestor }, { admin: null, salao: prof }, { admin: gestor, salao: gestor }, { admin: prof, salao: null }, { admin: semTotp, salao: null },
    ];
    for (const cred of cenarios) {
      for (const f of Object.values(ch)) expect(await f(cred)).toEqual({ ok: false, erro: 'acesso_negado', status: 403 });
    }
    expect((await salaoNoBanco(c, s.salaoId)).suspenso_manual_em).toBeNull();
    expect((await salaoNoBanco(c, s.salaoId)).nome).toBe(s.nome);
    expect(await contarAuditoria(c)).toBe(aud);
  });

  it('sessão de salão expirada ou revogada não vira 403: é 401', async () => {
    const s = await salaoEmTeste();
    const exp = await criarSessao(s.gestor.usuarioId, { expiraEm: new Date(Date.now() - 1000) });
    const rev = await criarSessao(s.gestor.usuarioId, { revogadaEm: new Date() });
    for (const salao of [exp.credencial, rev.credencial]) {
      expect(await chamadas(s.salaoId).suspender({ admin: null, salao })).toEqual({ ok: false, erro: 'nao_autenticado', status: 401 });
    }
  });

  it('super admin com TOTP executa; id desconhecido ou malformado é 404; recusa de negócio vem dentro de ok', async () => {
    const adm = await adminDeTeste();
    const s = await salaoEmTeste();
    const d = await lerSalao(adm.ctx, s.salaoId);
    expect(await suspenderSalao.executar(adm.cred, { salaoId: s.salaoId, motivo: 'Motivo qualquer', etapa: 'confirmar' })).toEqual({ ok: true, dados: { resultado: 'suspenso' } });
    expect(await suspenderSalao.executar(adm.cred, { salaoId: s.salaoId, motivo: 'Motivo qualquer', etapa: 'confirmar' })).toEqual({ ok: true, dados: { resultado: 'sem_efeito' } });
    expect(await reativarSalao.executar(adm.cred, { salaoId: s.salaoId })).toEqual({ ok: true, dados: { resultado: 'reativado' } });
    expect(await editarSalao.executar(adm.cred, entradaIgual(d, { nome: 'Nome pela ação' }))).toEqual({ ok: true, dados: { resultado: 'editado' } });
    expect((await salaoNoBanco(c, s.salaoId)).nome).toBe('Nome pela ação');
    expect(await estenderTeste.executar(adm.cred, { salaoId: s.salaoId, dias: '0', etapa: 'previa' })).toMatchObject({ ok: true, dados: { resultado: 'invalido' } });
    expect(await estenderTeste.executar(adm.cred, { salaoId: s.salaoId, dias: '4', etapa: 'previa' })).toMatchObject({ ok: true, dados: { resultado: 'previa', dias: 4 } });
    const outro = await salaoComAssinatura('ativa');
    expect(await estenderTeste.executar(adm.cred, { salaoId: outro.salaoId, dias: '4', etapa: 'previa' })).toEqual({ ok: true, dados: { resultado: 'recusado', motivo: 'estado' } });
    for (const salaoId of [randomUUID(), 'nao-e-uuid']) {
      for (const f of Object.values(chamadas(salaoId))) expect(await f(adm.cred)).toEqual({ ok: false, erro: 'nao_encontrado', status: 404 });
    }
  });

  it('estender de verdade pela ação usa o adaptador do registro (simulado) e grava', async () => {
    const adm = await adminDeTeste();
    const s = await salaoEmTeste();
    const r = await estenderTeste.executar(adm.cred, { salaoId: s.salaoId, dias: '3', testeFimEmEsperado: s.fim!.toISOString(), etapa: 'confirmar' });
    expect(r).toMatchObject({ ok: true, dados: { resultado: 'estendido', dias: 3 } });
  });
});
