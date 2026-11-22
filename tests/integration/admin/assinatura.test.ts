import { randomUUID } from 'node:crypto';

import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { lerAssinaturaDoSalao } from '@/server/admin/assinatura';
import { NaoEncontrado } from '@/server/tenant/erros';

import { adminDeTeste, salaoComAssinatura } from '../../support/admin-saloes';
import type { AdminDeTeste } from '../../support/admin-saloes';
import { contarAuditoria } from '../../support/auditoria';
import { criarSalaoCompleto } from '../../support/factories';
import { conectar } from '../../support/sql';

// D-045 CA-1, CA-7, CA-13: assinatura, transições e eventos de webhook de um salão. PostgreSQL real.
let c: pg.Client;
let adm: AdminDeTeste;
beforeAll(async () => {
  c = await conectar();
  adm = await adminDeTeste();
});
afterAll(async () => {
  await c?.end();
});

type Ev = { salaoId: string | null; resultado: string; tipo?: string | null; erro?: string | null; origemValida?: boolean; em: string; payload?: object; processadoEm?: string | null };
async function evento(e: Ev): Promise<string> {
  const { rows } = await c.query<{ id: string }>(
    `INSERT INTO webhook_evento (provedor, chave_dedupe, tipo, recurso_id, payload, origem_valida, resultado, salao_id, erro, recebido_em, processado_em)
     VALUES ('mercadopago', $1, $2, 'RECURSO-SECRETO', $3, $4, $5::resultado_webhook, $6, $7, $8, $9) RETURNING id::text`,
    [randomUUID(), e.tipo ?? 'payment', JSON.stringify(e.payload ?? { id: 'p1' }), e.origemValida ?? true, e.resultado, e.salaoId, e.erro ?? null, e.em, e.processadoEm ?? null],
  );
  return rows[0].id;
}
async function transicao(assinaturaId: string, de: string | null, para: string, causa: string, em: string, eventoId: string | null = null) {
  await c.query(`INSERT INTO assinatura_transicao (assinatura_id, de, para, causa, evento_id, ocorrida_em) VALUES ($1, $2::estado_assinatura, $3::estado_assinatura, $4, $5, $6)`, [assinaturaId, de, para, causa, eventoId, em]);
}

describe('CA-1: eventos do salão', () => {
  it('3 eventos do salão (um rejeitado) aparecem com data, tipo e resultado; os de outro salão e os sem salão, não', async () => {
    const a = await salaoComAssinatura('em_teste');
    const outro = await salaoComAssinatura('ativa');
    await evento({ salaoId: a.salaoId, resultado: 'processado', tipo: 'payment', em: '2026-11-20T10:00:00Z', processadoEm: '2026-11-20T10:00:01Z' });
    await evento({ salaoId: a.salaoId, resultado: 'rejeitado', tipo: 'subscription_preapproval', erro: 'vinculo_invalido', origemValida: false, em: '2026-11-21T10:00:00Z' });
    await evento({ salaoId: a.salaoId, resultado: 'recebido', tipo: 'payment', em: '2026-11-22T10:00:00Z' });
    await evento({ salaoId: outro.salaoId, resultado: 'erro', tipo: 'payment', em: '2026-11-22T11:00:00Z' });
    await evento({ salaoId: null, resultado: 'rejeitado', tipo: 'payment', em: '2026-11-22T12:00:00Z' });
    const r = await lerAssinaturaDoSalao(adm.ctx, a.salaoId);
    expect(r.eventos.map((e) => [e.resultado, e.tipo, e.recebidoEm, e.erro, e.origemValida])).toEqual([
      ['recebido', 'payment', '2026-11-22T10:00:00.000Z', null, true],
      ['rejeitado', 'subscription_preapproval', '2026-11-21T10:00:00.000Z', 'vinculo_invalido', false],
      ['processado', 'payment', '2026-11-20T10:00:00.000Z', null, true],
    ]);
    expect(r.eventos[2].processadoEm).toBe('2026-11-20T10:00:01.000Z');
    expect(r.maisEventos).toBe(false);
    expect(r.salao).toEqual({ id: a.salaoId, nome: expect.any(String), fuso: 'America/Sao_Paulo' });
  });

  it('erro fora do conjunto fechado vira nulo; payload sai como gravado; chave de dedupe e recurso nunca saem', async () => {
    const a = await salaoComAssinatura('ativa');
    await evento({ salaoId: a.salaoId, resultado: 'erro', erro: 'Falha para +5571987651234', em: '2026-11-22T10:00:00Z', payload: { id: 'x', nota: '<script>alert(1)</script>' } });
    const r = await lerAssinaturaDoSalao(adm.ctx, a.salaoId);
    expect(r.eventos[0].erro).toBeNull();
    expect(r.eventos[0].payload).toEqual({ id: 'x', nota: '<script>alert(1)</script>' });
    const json = JSON.stringify(r);
    for (const proibido of ['RECURSO-SECRETO', 'chave_dedupe', 'chaveDedupe', 'provedor_assinatura', 'provedorAssinaturaId', '5571987651234']) expect(json).not.toContain(proibido);
  });

  it('mais de 50 eventos: só os 50 mais recentes e o aviso', async () => {
    const a = await salaoComAssinatura('ativa');
    await c.query(
      `INSERT INTO webhook_evento (provedor, chave_dedupe, tipo, payload, origem_valida, resultado, salao_id, recebido_em)
       SELECT 'mercadopago', gen_random_uuid()::text, 'payment', '{}'::jsonb, true, 'processado', $1, '2026-11-01T00:00:00Z'::timestamptz + g * interval '1 minute'
         FROM generate_series(1, 53) g`,
      [a.salaoId],
    );
    const r = await lerAssinaturaDoSalao(adm.ctx, a.salaoId);
    expect(r.eventos).toHaveLength(50);
    expect(r.maisEventos).toBe(true);
    expect(r.eventos[0].recebidoEm > r.eventos[49].recebidoEm).toBe(true);
    expect(r.eventos[0].recebidoEm).toBe('2026-11-01T00:53:00.000Z');
  });
});

describe('resumo e transições', () => {
  it('resumo sem o id do provedor; campos nulos ficam nulos; vinculada é só um booleano', async () => {
    const a = await salaoComAssinatura('em_carencia', { carenciaAte: new Date('2026-11-25T12:00:00Z'), primeiraFalhaEm: new Date('2026-11-22T12:00:00Z') });
    await c.query(`UPDATE assinatura SET provedor_assinatura_id = 'PROVEDOR-SECRETO-1' WHERE id = $1`, [a.assinaturaId]);
    const r = await lerAssinaturaDoSalao(adm.ctx, a.salaoId);
    expect(r.assinatura).toMatchObject({ estado: 'em_carencia', vinculada: true, carenciaAte: '2026-11-25T12:00:00.000Z', primeiraFalhaEm: '2026-11-22T12:00:00.000Z', canceladaEm: null });
    expect(JSON.stringify(r)).not.toContain('PROVEDOR-SECRETO-1');
  });

  it('transições de todas as assinaturas do salão, mais recentes primeiro; origem evento; causa truncada em 80', async () => {
    const a = await salaoComAssinatura('ativa');
    const ev = await evento({ salaoId: a.salaoId, resultado: 'processado', em: '2026-11-20T10:00:00Z' });
    await transicao(a.assinaturaId!, null, 'pendente', 'criada', '2026-11-01T10:00:00Z');
    await transicao(a.assinaturaId!, 'pendente', 'ativa', 'pagamento_aprovado', '2026-11-20T10:00:00Z', ev);
    await transicao(a.assinaturaId!, 'ativa', 'em_carencia', 'x'.repeat(200), '2026-11-21T10:00:00Z');
    const r = await lerAssinaturaDoSalao(adm.ctx, a.salaoId);
    expect(r.transicoes.map((t) => [t.de, t.para, t.origemEvento])).toEqual([
      ['ativa', 'em_carencia', false],
      ['pendente', 'ativa', true],
      [null, 'pendente', false],
    ]);
    expect(Array.from(r.transicoes[0].causa)).toHaveLength(81);
    expect(r.transicoes[1].causa).toBe('pagamento_aprovado');
  });

  it('mais de 50 transições: as 50 mais recentes', async () => {
    const a = await salaoComAssinatura('ativa');
    await c.query(
      `INSERT INTO assinatura_transicao (assinatura_id, de, para, causa, ocorrida_em)
       SELECT $1, 'ativa', 'em_carencia', 'c' || g, '2026-11-01T00:00:00Z'::timestamptz + g * interval '1 minute' FROM generate_series(1, 55) g`,
      [a.assinaturaId],
    );
    const r = await lerAssinaturaDoSalao(adm.ctx, a.salaoId);
    expect(r.transicoes).toHaveLength(50);
    expect(r.transicoes[0].causa).toBe('c55');
  });

  it('assinatura encerrada + vigente: o resumo é da vigente', async () => {
    const a = await salaoComAssinatura('encerrada');
    await c.query(`INSERT INTO assinatura (salao_id, estado) VALUES ($1, 'ativa')`, [a.salaoId]);
    expect((await lerAssinaturaDoSalao(adm.ctx, a.salaoId)).assinatura?.estado).toBe('ativa');
  });
});

describe('CA-13: vazios e 404', () => {
  it('salão sem assinatura, sem transições e sem eventos', async () => {
    const s = await criarSalaoCompleto();
    const r = await lerAssinaturaDoSalao(adm.ctx, s.salaoId);
    expect(r.assinatura).toBeNull();
    expect(r.transicoes).toEqual([]);
    expect(r.eventos).toEqual([]);
    expect(r.maisEventos).toBe(false);
  });

  it('malformado e inexistente → NaoEncontrado', async () => {
    for (const id of ['x', '', undefined, '00000000-0000-4000-8000-000000000000']) {
      await expect(lerAssinaturaDoSalao(adm.ctx, id)).rejects.toBeInstanceOf(NaoEncontrado);
    }
  });

  it('CA-7: a leitura não audita', async () => {
    const s = await criarSalaoCompleto();
    const n = await contarAuditoria(c);
    await lerAssinaturaDoSalao(adm.ctx, s.salaoId);
    expect(await contarAuditoria(c)).toBe(n);
  });
});
