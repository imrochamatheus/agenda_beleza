import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';

import { encerrarPrisma, obterPrisma } from '@/server/repos/db';
import { repos } from '@/server/repos';
import { emTransacao } from '@/server/repos/transacao';

import { criarAssinaturaEm } from '../../support/assinatura';
import { AGORA, D, salaoGestor } from './apoio-cancelar';
import { criarSalaoD40 } from './apoio-iniciar';

// D-042 §3.2: lerDetalhe (um comando, mais recente, escopado), listarPagamentos (12, ordem, sem ids) e
// confirmarProvedor com `null`.

afterAll(async () => {
  await encerrarPrisma();
});

async function pagar(assinaturaId: string, n: number, criadoEm: Date, status = 'aprovado') {
  await obterPrisma().assinaturaPagamento.create({ data: { assinaturaId, pagamentoId: `p-${randomUUID()}-${n}`, status, valorCentavos: 7900 + n, criadoEm } });
}

describe('RepoAssinatura.lerDetalhe', () => {
  it('sem assinatura: fuso do salão e assinatura nula; salão inexistente lança NaoEncontrado', async () => {
    const s = await criarSalaoD40();
    expect(await repos().assinaturas.lerDetalhe(s.ctx)).toEqual({ fuso: 'America/Sao_Paulo', suspensoManualEm: null, assinatura: null });
    await obterPrisma().salao.update({ where: { id: s.salaoId }, data: { fuso: 'America/Manaus', suspensoManualEm: AGORA } });
    expect(await repos().assinaturas.lerDetalhe(s.ctx)).toMatchObject({ fuso: 'America/Manaus', suspensoManualEm: AGORA });
    await expect(repos().assinaturas.lerDetalhe({ ...s.ctx, salaoId: randomUUID() })).rejects.toThrow();
  });

  it('devolve a mais recente (a encerrada antiga fica de fora) com as datas e o vínculo', async () => {
    const s = await criarSalaoD40();
    await criarAssinaturaEm(s.salaoId, 'encerrada', { criadoEm: D('2027-01-01T00:00:00Z') });
    const id = await criarAssinaturaEm(s.salaoId, 'em_teste', { criadoEm: D('2027-03-01T00:00:00Z'), testeFimEm: D('2027-04-01T00:00:00Z') });
    await obterPrisma().assinatura.update({ where: { id }, data: { provedorAssinaturaId: 'prov-1' } });
    const d = await repos().assinaturas.lerDetalhe(s.ctx);
    expect(d.assinatura).toEqual({
      id,
      estado: 'em_teste',
      testeFimEm: D('2027-04-01T00:00:00Z'),
      periodoPagoAte: null,
      carenciaAte: null,
      acessoAte: null,
      provedorAssinaturaId: 'prov-1',
    });
  });

  it('isolamento: cada salão lê só a própria assinatura', async () => {
    const a = await salaoGestor('em_teste', { testeFimEm: D('2027-06-01T00:00:00Z') });
    const b = await salaoGestor('ativa', { periodoPagoAte: D('2027-06-02T00:00:00Z') });
    expect((await repos().assinaturas.lerDetalhe(a.ctx)).assinatura?.id).toBe(a.assinaturaId);
    expect((await repos().assinaturas.lerDetalhe(b.ctx)).assinatura?.id).toBe(b.assinaturaId);
  });
});

describe('RepoAssinatura.listarPagamentos', () => {
  it('no máximo `limite`, mais recentes primeiro, de todas as assinaturas do salão, sem ids e sem outro salão', async () => {
    const a = await criarSalaoD40();
    const b = await criarSalaoD40();
    const velha = await criarAssinaturaEm(a.salaoId, 'encerrada', { criadoEm: D('2026-01-01T00:00:00Z') });
    const atual = await criarAssinaturaEm(a.salaoId, 'ativa', { criadoEm: D('2027-01-01T00:00:00Z') });
    const deB = await criarAssinaturaEm(b.salaoId, 'ativa');
    await pagar(velha, 0, D('2026-02-01T00:00:00Z'), 'recusado');
    for (let i = 1; i <= 13; i += 1) await pagar(atual, i, new Date(D('2027-02-01T00:00:00Z').getTime() + i * 86_400_000));
    await pagar(deB, 99, D('2027-03-01T00:00:00Z'));
    const lista = await repos().assinaturas.listarPagamentos(a.ctx, 12);
    expect(lista).toHaveLength(12);
    expect(lista[0].valorCentavos).toBe(7913);
    expect(lista[11].valorCentavos).toBe(7902);
    expect(lista.every((p) => p.status === 'aprovado')).toBe(true);
    expect(Object.keys(lista[0]).sort()).toEqual(['criadoEm', 'status', 'valorCentavos']);
    const tudo = await repos().assinaturas.listarPagamentos(a.ctx, 50);
    expect(tudo).toHaveLength(14);
    expect(tudo[13].status).toBe('recusado');
    expect((await repos().assinaturas.listarPagamentos(b.ctx, 12)).map((p) => p.valorCentavos)).toEqual([7999]);
    expect(await repos().assinaturas.listarPagamentos((await criarSalaoD40()).ctx, 12)).toEqual([]);
  });
});

describe('RepoAssinatura.confirmarProvedor com null', () => {
  it('null confere "ainda sem vínculo"; com vínculo, null e outro valor falham', async () => {
    const s = await criarSalaoD40();
    const sem = await criarAssinaturaEm(s.salaoId, 'pendente');
    const r1 = await emTransacao(async (t) => [
      await t.assinaturas.confirmarProvedor(s.ctx, { id: sem, provedorId: null }),
      await t.assinaturas.confirmarProvedor(s.ctx, { id: sem, provedorId: 'x' }),
    ]);
    expect(r1).toEqual([true, false]);
    await obterPrisma().assinatura.update({ where: { id: sem }, data: { provedorAssinaturaId: 'x' } });
    const r2 = await emTransacao(async (t) => [
      await t.assinaturas.confirmarProvedor(s.ctx, { id: sem, provedorId: null }),
      await t.assinaturas.confirmarProvedor(s.ctx, { id: sem, provedorId: 'x' }),
    ]);
    expect(r2).toEqual([false, true]);
  });
});
