import { afterAll, describe, expect, it } from 'vitest';

import { iniciarAssinatura } from '@/server/assinatura/iniciar';
import { consultarRetorno } from '@/server/assinatura/retorno';
import { encerrarPrisma } from '@/server/repos/db';

import { APP_URL, criarSalaoD40, mp, simDoSalao, transicoes, vigenteDe } from './apoio-iniciar';

// D-040 CA-9: iniciar x iniciar e retorno x retorno em paralelo, sem 23505, sem impasse (40P01) e sem 5xx.

afterAll(async () => {
  await encerrarPrisma();
});

const AGORA = new Date('2027-05-10T12:00:00Z');

describe('concorrência da assinatura (D-040)', () => {
  it('CA-9: 10 iniciar em paralelo no mesmo salão: 1 vigente, vínculo coerente', async () => {
    const { salaoId, ctx } = await criarSalaoD40();
    const rs = await Promise.allSettled(Array.from({ length: 10 }, () => iniciarAssinatura(ctx, AGORA, { mp, appUrl: APP_URL })));
    expect(rs.filter((r) => r.status === 'rejected').map((r) => String((r as PromiseRejectedResult).reason))).toEqual([]);
    const res = rs.map((r) => (r as PromiseFulfilledResult<{ resultado: string }>).value.resultado);
    expect(res.every((x) => x === 'iniciada' || x === 'tente_novamente')).toBe(true);
    expect(res.filter((x) => x === 'iniciada').length).toBeGreaterThanOrEqual(1);
    const vig = await vigenteDe(salaoId);
    expect(vig).toHaveLength(1);
    const sims = await simDoSalao(salaoId);
    const viva = sims.filter((s) => s.estado !== 'cancelada');
    expect(viva.map((s) => s.id)).toContain(vig[0].provedorAssinaturaId);
  });

  it('CA-9: 10 retornos em paralelo após a autorização: uma transição pendente -> em_teste', async () => {
    const { salaoId, ctx } = await criarSalaoD40();
    await iniciarAssinatura(ctx, AGORA, { mp, appUrl: APP_URL });
    const [sim] = await simDoSalao(salaoId);
    await mp.autorizar(sim.id, { em: AGORA });
    const rs = await Promise.allSettled(Array.from({ length: 10 }, () => consultarRetorno(ctx, AGORA, { mp })));
    expect(rs.filter((r) => r.status === 'rejected').map((r) => String((r as PromiseRejectedResult).reason))).toEqual([]);
    const res = rs.map((r) => (r as PromiseFulfilledResult<string>).value);
    expect(res.filter((x) => x === 'teste_iniciado')).toHaveLength(1);
    expect(res.filter((x) => x === 'ja_em_teste')).toHaveLength(9);
    const [a] = await vigenteDe(salaoId);
    const t = await transicoes(a.id);
    expect(t).toHaveLength(1);
    expect([t[0].de, t[0].para]).toEqual(['pendente', 'em_teste']);
  });

  it('iniciar x retorno em paralelo não trava nem quebra', async () => {
    const { salaoId, ctx } = await criarSalaoD40();
    await iniciarAssinatura(ctx, AGORA, { mp, appUrl: APP_URL });
    const rs = await Promise.allSettled([
      iniciarAssinatura(ctx, AGORA, { mp, appUrl: APP_URL }),
      consultarRetorno(ctx, AGORA, { mp }),
      iniciarAssinatura(ctx, AGORA, { mp, appUrl: APP_URL }),
      consultarRetorno(ctx, AGORA, { mp }),
    ]);
    expect(rs.filter((r) => r.status === 'rejected')).toEqual([]);
    expect(await vigenteDe(salaoId)).toHaveLength(1);
  });
});
