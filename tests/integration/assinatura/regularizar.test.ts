import { afterAll, describe, expect, it } from 'vitest';

import { regularizarAssinatura } from '@/server/assinatura/regularizar';
import { NaoImplementado } from '@/server/integrations/nao-implementado';
import type { PortaMercadoPago } from '@/server/integrations/mercadopago/port';
import { encerrarPrisma, obterPrisma } from '@/server/repos/db';

import { lerAssinatura, transicoesDe } from '../../support/assinatura';
import { APP_URL, AGORA, D, espiar, mp, nuncaChamada, salaoGestor } from './apoio-cancelar';

// D-042 CA-9 (URL do simulado, sem escrita), CA-13 (falha → erro de pagamento, estado intacto) e RN-7.

afterAll(async () => {
  await encerrarPrisma();
});

describe('regularizarAssinatura', () => {
  it.each(['ativa', 'em_carencia', 'suspensa'] as const)('CA-9: %s devolve a URL do simulado e não grava nada', async (estado) => {
    const s = await salaoGestor(estado, { carenciaAte: D('2027-05-12T00:00:00Z'), periodoPagoAte: D('2027-05-25T00:00:00Z') });
    const antes = await lerAssinatura(s.assinaturaId);
    const r = await regularizarAssinatura(s.ctx, AGORA, { mp });
    expect(r).toEqual({ resultado: 'iniciada', url: `${APP_URL}/dev/mp-checkout?assinatura=${s.simId}` });
    expect(await lerAssinatura(s.assinaturaId)).toEqual(antes);
    expect(await transicoesDe(s.assinaturaId)).toHaveLength(0);
  });

  it('CA-13: erro forçado → provedor_indisponivel, sem mudança de estado; depois da repetição funciona', async () => {
    const s = await salaoGestor('em_carencia', { carenciaAte: D('2027-05-12T00:00:00Z') });
    const antes = await lerAssinatura(s.assinaturaId);
    await mp.forcarErro('urlAtualizarMeioPagamento');
    expect(await regularizarAssinatura(s.ctx, AGORA, { mp })).toEqual({ resultado: 'provedor_indisponivel' });
    expect(await lerAssinatura(s.assinaturaId)).toEqual(antes);
    expect((await regularizarAssinatura(s.ctx, AGORA, { mp })).resultado).toBe('iniciada');
  });

  it('NaoImplementado do adaptador real e URL que não é http(s) → provedor_indisponivel', async () => {
    const s = await salaoGestor('ativa', { periodoPagoAte: D('2027-05-25T00:00:00Z') });
    const real = { ...mp, urlAtualizarMeioPagamento: () => Promise.reject(new NaoImplementado('E6.6')) } as PortaMercadoPago;
    expect(await regularizarAssinatura(s.ctx, AGORA, { mp: real })).toEqual({ resultado: 'provedor_indisponivel' });
    const maliciosa = { ...mp, urlAtualizarMeioPagamento: async () => 'javascript:alert(1)' } as PortaMercadoPago;
    expect(await regularizarAssinatura(s.ctx, AGORA, { mp: maliciosa })).toEqual({ resultado: 'provedor_indisponivel' });
    const quebrada = { ...mp, urlAtualizarMeioPagamento: () => Promise.reject(new TypeError('bug')) } as PortaMercadoPago;
    await expect(regularizarAssinatura(s.ctx, AGORA, { mp: quebrada })).rejects.toThrow('bug');
  });

  it('pendente reaproveita o início: devolve o checkout (nova assinatura no provedor) sem transição', async () => {
    const s = await salaoGestor('pendente');
    const r = await regularizarAssinatura(s.ctx, AGORA, { mp, appUrl: APP_URL });
    expect(r.resultado).toBe('iniciada');
    expect(await transicoesDe(s.assinaturaId)).toHaveLength(0);
  });

  it('pendente com o provedor já autorizado inicia o teste (teste_iniciado)', async () => {
    const s = await salaoGestor('pendente');
    await mp.autorizar(s.simId!, { em: AGORA });
    expect(await regularizarAssinatura(s.ctx, AGORA, { mp, appUrl: APP_URL })).toEqual({ resultado: 'teste_iniciado' });
    expect((await lerAssinatura(s.assinaturaId)).estado).toBe('em_teste');
  });

  it('pendente com provedor indisponível → provedor_indisponivel', async () => {
    const s = await salaoGestor('pendente');
    await mp.forcarErro('consultarAssinatura');
    expect(await regularizarAssinatura(s.ctx, AGORA, { mp, appUrl: APP_URL })).toEqual({ resultado: 'provedor_indisponivel' });
  });

  it('RN-7: em_teste, cancelada, encerrada, sem assinatura e manual recusam sem chamar o provedor', async () => {
    const e = espiar();
    for (const estado of ['em_teste', 'cancelada', 'encerrada'] as const) {
      const s = await salaoGestor(estado, { acessoAte: D('2027-06-01T00:00:00Z'), testeFimEm: D('2027-06-01T00:00:00Z') });
      expect(await regularizarAssinatura(s.ctx, AGORA, { mp: e })).toEqual({ resultado: 'recusado', motivo: 'estado' });
    }
    const man = await salaoGestor('ativa', { periodoPagoAte: D('2027-05-25T00:00:00Z') });
    await obterPrisma().salao.update({ where: { id: man.salaoId }, data: { suspensoManualEm: AGORA } });
    expect(await regularizarAssinatura(man.ctx, AGORA, { mp: e })).toEqual({ resultado: 'recusado', motivo: 'manual' });
    const sem = await salaoGestor('ativa', {}, { semVinculo: true });
    expect(await regularizarAssinatura(sem.ctx, AGORA, { mp: e })).toEqual({ resultado: 'recusado', motivo: 'sem_vinculo' });
    await obterPrisma().assinatura.delete({ where: { id: sem.assinaturaId } });
    expect(await regularizarAssinatura(sem.ctx, AGORA, { mp: nuncaChamada })).toEqual({ resultado: 'recusado', motivo: 'estado' });
    expect(e.chamadas).toEqual([]);
  });
});
