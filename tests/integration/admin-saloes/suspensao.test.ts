import { randomUUID } from 'node:crypto';

import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { reativarSalao, suspenderSalao } from '@/server/admin/saloes';
import { estadoEfetivoDoSalao } from '@/server/assinatura/estado-operacional';
import { encerrarPrisma, obterPrisma } from '@/server/repos/db';
import { contextoDeSistema } from '@/server/tenant/context';
import { NaoEncontrado } from '@/server/tenant/erros';

import { adminDeTeste, assinaturaNoBanco, salaoComAssinatura, salaoNoBanco, sessoesAtivas } from '../../support/admin-saloes';
import type { AdminDeTeste } from '../../support/admin-saloes';
import { linhasDeAuditoria } from '../../support/auditoria';
import { criarSessao } from '../../support/auth';
import { conectar } from '../../support/sql';

// D-044 CA-2 e CA-3: suspender e reativar manualmente (só o indicador; assinatura e sessões intactas).
let c: pg.Client;
let adm: AdminDeTeste;
const AGORA = new Date('2027-05-10T12:00:00Z');

beforeAll(async () => {
  c = await conectar();
  adm = await adminDeTeste();
});
afterAll(async () => {
  await c.end();
  await encerrarPrisma();
});

const auditoriaDo = (salaoId: string) => linhasDeAuditoria(c, `salao_id = $1 AND acao LIKE 'salao.%'`, [salaoId]);
const sistema = (id: string) => contextoDeSistema(id, 'teste');

describe('CA-2: suspender', () => {
  it('a etapa previa não grava nem audita; confirmar grava, audita com motivo e tira a capacidade de agendar', async () => {
    const s = await salaoComAssinatura('ativa', { periodoPagoAte: new Date('2027-06-01T00:00:00Z') });
    const previa = await suspenderSalao(adm.ctx, { salaoId: s.salaoId, motivo: '  Pedido   do gestor ', etapa: 'previa' }, AGORA);
    expect(previa).toEqual({ resultado: 'previa', motivo: 'Pedido do gestor' });
    expect((await salaoNoBanco(c, s.salaoId)).suspenso_manual_em).toBeNull();
    expect(await auditoriaDo(s.salaoId)).toHaveLength(0);
    expect((await estadoEfetivoDoSalao(sistema(s.salaoId), AGORA)).capacidades.agendar).toBe(true);

    const r = await suspenderSalao(adm.ctx, { salaoId: s.salaoId, motivo: 'Pedido do gestor', etapa: 'confirmar' }, AGORA);
    expect(r).toEqual({ resultado: 'suspenso' });
    expect((await salaoNoBanco(c, s.salaoId)).suspenso_manual_em).toEqual(AGORA);
    const efetivo = await estadoEfetivoDoSalao(sistema(s.salaoId), AGORA);
    expect(efetivo).toMatchObject({ estado: 'manual', motivo: 'manual' });
    expect(efetivo.capacidades.agendar).toBe(false);
    expect(efetivo.capacidades.cancelar).toBe(true);
    const aud = await auditoriaDo(s.salaoId);
    expect(aud).toHaveLength(1);
    expect(aud[0]).toMatchObject({
      acao: 'salao.suspender', entidade: 'salao', entidade_id: s.salaoId, ator_id: adm.usuarioId, resultado: 'sucesso',
      antes: { suspenso_manual_em: null }, depois: { suspenso_manual_em: AGORA.toISOString(), motivo: 'Pedido do gestor' },
    });
  });

  it('uma etapa desconhecida vale como previa: nunca grava', async () => {
    const s = await salaoComAssinatura('ativa');
    for (const etapa of [undefined, '', 'CONFIRMAR', 1, null]) {
      expect((await suspenderSalao(adm.ctx, { salaoId: s.salaoId, motivo: 'Motivo válido', etapa }, AGORA)).resultado).toBe('previa');
    }
    expect((await salaoNoBanco(c, s.salaoId)).suspenso_manual_em).toBeNull();
  });

  it('motivo vazio, curto, longo ou com e-mail/telefone: erro de campo, nada gravado', async () => {
    const s = await salaoComAssinatura('ativa');
    for (const motivo of ['', '    ', 'abcd', 'a'.repeat(281), 'avisar ana@exemplo.com.br', 'ligar (11) 98765-4321', undefined]) {
      const r = await suspenderSalao(adm.ctx, { salaoId: s.salaoId, motivo, etapa: 'confirmar' }, AGORA);
      expect(r).toMatchObject({ resultado: 'invalido', erros: { motivo: expect.any(String) } });
    }
    expect((await salaoNoBanco(c, s.salaoId)).suspenso_manual_em).toBeNull();
    expect(await auditoriaDo(s.salaoId)).toHaveLength(0);
  });

  it('suspender duas vezes: a segunda é sem_efeito e há uma só auditoria', async () => {
    const s = await salaoComAssinatura('ativa');
    expect((await suspenderSalao(adm.ctx, { salaoId: s.salaoId, motivo: 'Primeira vez', etapa: 'confirmar' }, AGORA)).resultado).toBe('suspenso');
    const de = (await salaoNoBanco(c, s.salaoId)).suspenso_manual_em;
    expect((await suspenderSalao(adm.ctx, { salaoId: s.salaoId, motivo: 'Segunda vez', etapa: 'confirmar' }, new Date('2027-06-01T00:00:00Z'))).resultado).toBe('sem_efeito');
    expect((await suspenderSalao(adm.ctx, { salaoId: s.salaoId, motivo: 'Terceira vez', etapa: 'previa' }, AGORA)).resultado).toBe('sem_efeito');
    expect((await salaoNoBanco(c, s.salaoId)).suspenso_manual_em).toEqual(de);
    expect(await auditoriaDo(s.salaoId)).toHaveLength(1);
  });
});

describe('CA-2: reativar', () => {
  it('limpa o indicador, devolve a capacidade, audita antes/depois e repetir é sem_efeito', async () => {
    const s = await salaoComAssinatura('ativa');
    await suspenderSalao(adm.ctx, { salaoId: s.salaoId, motivo: 'Por precaução', etapa: 'confirmar' }, AGORA);
    const depois = new Date('2027-05-11T09:00:00Z');
    expect(await reativarSalao(adm.ctx, { salaoId: s.salaoId, motivo: 'Resolvido com o gestor' }, depois)).toEqual({ resultado: 'reativado' });
    expect((await salaoNoBanco(c, s.salaoId)).suspenso_manual_em).toBeNull();
    expect((await estadoEfetivoDoSalao(sistema(s.salaoId), depois)).capacidades.agendar).toBe(true);
    const aud = await auditoriaDo(s.salaoId);
    expect(aud.map((a) => a.acao)).toEqual(['salao.suspender', 'salao.reativar']);
    expect(aud[1]).toMatchObject({
      antes: { suspenso_manual_em: AGORA.toISOString() }, depois: { suspenso_manual_em: null, motivo: 'Resolvido com o gestor' },
    });
    expect(await reativarSalao(adm.ctx, { salaoId: s.salaoId }, depois)).toEqual({ resultado: 'sem_efeito' });
    expect(await auditoriaDo(s.salaoId)).toHaveLength(2);
  });

  it('o motivo é opcional, mas se vier precisa valer', async () => {
    const s = await salaoComAssinatura('ativa');
    await suspenderSalao(adm.ctx, { salaoId: s.salaoId, motivo: 'Por precaução', etapa: 'confirmar' }, AGORA);
    expect(await reativarSalao(adm.ctx, { salaoId: s.salaoId, motivo: 'oi' }, AGORA)).toMatchObject({ resultado: 'invalido' });
    expect((await salaoNoBanco(c, s.salaoId)).suspenso_manual_em).not.toBeNull();
    expect(await reativarSalao(adm.ctx, { salaoId: s.salaoId, motivo: '   ' }, AGORA)).toEqual({ resultado: 'reativado' });
    const aud = await auditoriaDo(s.salaoId);
    expect(aud[1].depois).toEqual({ suspenso_manual_em: null });
  });
});

describe('CA-3: nenhuma assinatura nem sessão é tocada', () => {
  it('suspender e reativar deixam a linha da assinatura e as sessões do gestor iguais', async () => {
    const s = await salaoComAssinatura('em_carencia', { carenciaAte: new Date('2027-05-20T00:00:00Z'), primeiraFalhaEm: new Date('2027-05-17T00:00:00Z') });
    await criarSessao(s.gestor.usuarioId);
    const antes = await assinaturaNoBanco(s.assinaturaId!);
    const sessoes = await sessoesAtivas(c, s.gestor.usuarioId);
    await suspenderSalao(adm.ctx, { salaoId: s.salaoId, motivo: 'Investigação em curso', etapa: 'confirmar' }, AGORA);
    expect(await assinaturaNoBanco(s.assinaturaId!)).toEqual(antes);
    expect(await sessoesAtivas(c, s.gestor.usuarioId)).toBe(sessoes);
    await reativarSalao(adm.ctx, { salaoId: s.salaoId }, AGORA);
    expect(await assinaturaNoBanco(s.assinaturaId!)).toEqual(antes);
    expect(await sessoesAtivas(c, s.gestor.usuarioId)).toBe(sessoes);
    expect(await obterPrisma().assinaturaTransicao.count({ where: { assinaturaId: s.assinaturaId! } })).toBe(0);
  });

  it('salão suspenso pela assinatura: reativar o indicador manual NÃO reativa a assinatura', async () => {
    const s = await salaoComAssinatura('suspensa');
    await suspenderSalao(adm.ctx, { salaoId: s.salaoId, motivo: 'Também manual', etapa: 'confirmar' }, AGORA);
    await reativarSalao(adm.ctx, { salaoId: s.salaoId }, AGORA);
    expect((await assinaturaNoBanco(s.assinaturaId!)).estado).toBe('suspensa');
    expect((await estadoEfetivoDoSalao(sistema(s.salaoId), AGORA)).capacidades.agendar).toBe(false);
  });
});

describe('CA-10/CA-13: salão inexistente ou id malformado é 404 e nada muda em outro salão', () => {
  it('lança NaoEncontrado para id que não é UUID e para UUID desconhecido', async () => {
    for (const salaoId of ['nao-e-uuid', '', null, undefined, 42, randomUUID()]) {
      await expect(suspenderSalao(adm.ctx, { salaoId, motivo: 'Motivo válido', etapa: 'confirmar' }, AGORA)).rejects.toBeInstanceOf(NaoEncontrado);
      await expect(reativarSalao(adm.ctx, { salaoId }, AGORA)).rejects.toBeInstanceOf(NaoEncontrado);
    }
  });

  it('agir em um salão não altera o outro', async () => {
    const a = await salaoComAssinatura('ativa');
    const b = await salaoComAssinatura('ativa');
    await suspenderSalao(adm.ctx, { salaoId: a.salaoId, motivo: 'Só o primeiro', etapa: 'confirmar' }, AGORA);
    expect((await salaoNoBanco(c, b.salaoId)).suspenso_manual_em).toBeNull();
    expect(await auditoriaDo(b.salaoId)).toHaveLength(0);
  });
});
