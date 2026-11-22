import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';

import { repos } from '@/server/repos';
import { encerrarPrisma } from '@/server/repos/db';
import { emTransacao } from '@/server/repos/transacao';
import { contextoDeSistema } from '@/server/tenant/context';

import { criarAssinaturaEm, criarSalaoSemAssinatura } from '../../support/assinatura';
import { criarSalaoD40, vigenteDe, transicoes } from './apoio-iniciar';

// D-040 T-2: os quatro métodos novos de RepoAssinatura.

afterAll(async () => {
  await encerrarPrisma();
});

const AGORA = new Date('2027-05-10T12:00:00Z');

describe('RepoAssinatura (D-040)', () => {
  it('criarPendenteSeNaoHouver: cria uma vez, é idempotente e não escreve transição', async () => {
    const { ctx, salaoId } = await criarSalaoD40();
    expect(await repos().assinaturas.criarPendenteSeNaoHouver(ctx, AGORA)).toBe(true);
    expect(await repos().assinaturas.criarPendenteSeNaoHouver(ctx, AGORA)).toBe(false);
    const vig = await vigenteDe(salaoId);
    expect(vig).toHaveLength(1);
    expect(vig[0].atualizadoEm.toISOString()).toBe(AGORA.toISOString());
    expect(await transicoes(vig[0].id)).toHaveLength(0);
  });

  it('criarPendenteSeNaoHouver: vigente de outro estado ou só encerrada', async () => {
    const a = await criarSalaoSemAssinatura();
    await criarAssinaturaEm(a.salaoId, 'ativa');
    expect(await repos().assinaturas.criarPendenteSeNaoHouver(a.ctx, AGORA)).toBe(false);
    const b = await criarSalaoSemAssinatura();
    await criarAssinaturaEm(b.salaoId, 'encerrada');
    expect(await repos().assinaturas.criarPendenteSeNaoHouver(b.ctx, AGORA)).toBe(true);
  });

  it('lerVigente: e-mail só do usuário do mesmo salão; sistema sem e-mail; outro salão não enxerga', async () => {
    const a = await criarSalaoD40();
    const b = await criarSalaoD40();
    expect(await repos().assinaturas.lerVigente(a.ctx)).toBeNull();
    await repos().assinaturas.criarPendenteSeNaoHouver(a.ctx, AGORA);
    const v = await repos().assinaturas.lerVigente(a.ctx);
    expect(v).toMatchObject({ estado: 'pendente', provedorAssinaturaId: null, emailGestor: a.s.gestor.email });
    expect((await repos().assinaturas.lerVigente(contextoDeSistema(a.salaoId, 'teste')))?.emailGestor).toBeNull();
    expect(await repos().assinaturas.lerVigente(b.ctx)).toBeNull();
  });

  it('trocarProvedor é compare-and-swap: só vale com o vínculo esperado, no salão e na pendente', async () => {
    const a = await criarSalaoD40();
    const b = await criarSalaoD40();
    await repos().assinaturas.criarPendenteSeNaoHouver(a.ctx, AGORA);
    const v = (await repos().assinaturas.lerVigente(a.ctx))!;
    const R = repos().assinaturas;
    expect(await R.trocarProvedor(a.ctx, { id: v.id, de: 'x', para: 'p1', agora: AGORA })).toBe(false);
    expect(await R.trocarProvedor(b.ctx, { id: v.id, de: null, para: 'p1', agora: AGORA })).toBe(false);
    expect(await R.trocarProvedor(a.ctx, { id: 'não-uuid', de: null, para: 'p1', agora: AGORA })).toBe(false);
    expect(await R.trocarProvedor(a.ctx, { id: v.id, de: null, para: 'p1', agora: AGORA })).toBe(true);
    expect(await R.trocarProvedor(a.ctx, { id: v.id, de: null, para: 'p2', agora: AGORA })).toBe(false);
    expect(await R.trocarProvedor(a.ctx, { id: v.id, de: 'p1', para: 'p2', agora: AGORA })).toBe(true);
    expect((await vigenteDe(a.salaoId))[0].provedorAssinaturaId).toBe('p2');
  });

  it('trocarProvedor não age em linha que deixou de ser pendente', async () => {
    const a = await criarSalaoD40();
    const id = await criarAssinaturaEm(a.salaoId, 'em_teste');
    expect(await repos().assinaturas.trocarProvedor(a.ctx, { id, de: null, para: 'p1', agora: AGORA })).toBe(false);
  });

  it('confirmarProvedor trava a linha e confere o vínculo', async () => {
    const a = await criarSalaoD40();
    const b = await criarSalaoD40();
    await repos().assinaturas.criarPendenteSeNaoHouver(a.ctx, AGORA);
    const v = (await repos().assinaturas.lerVigente(a.ctx))!;
    await repos().assinaturas.trocarProvedor(a.ctx, { id: v.id, de: null, para: 'p1', agora: AGORA });
    const r = await emTransacao(async (t) => [
      await t.assinaturas.confirmarProvedor(a.ctx, { id: v.id, provedorId: 'p1' }),
      await t.assinaturas.confirmarProvedor(a.ctx, { id: v.id, provedorId: 'outro' }),
      await t.assinaturas.confirmarProvedor(b.ctx, { id: v.id, provedorId: 'p1' }),
      await t.assinaturas.confirmarProvedor(a.ctx, { id: randomUUID(), provedorId: 'p1' }),
      await t.assinaturas.confirmarProvedor(a.ctx, { id: 'x', provedorId: 'p1' }),
    ]);
    expect(r).toEqual([true, false, false, false, false]);
  });
});
