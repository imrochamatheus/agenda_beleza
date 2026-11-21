import { afterAll, describe, expect, it } from 'vitest';

import { aplicarEventoAssinatura } from '@/server/assinatura/servico';
import { encerrarPrisma } from '@/server/repos/db';

import { criarSalaoComAssinatura, iso, lerAssinatura, pagamentosDe, transicoesDe } from '../../support/assinatura';

// D-037 CA-12: idempotência por pagamento_id e atomicidade com o UPDATE de pago_ate.

afterAll(async () => {
  await encerrarPrisma();
});

const AGORA = new Date('2027-03-10T00:00:00Z');
const ev = (pagamentoId: string) => ({ tipo: 'cobranca_aprovada' as const, pagamentoId, valorCentavos: 7900, pagoEm: AGORA });

describe('idempotência do pagamento', () => {
  it('mesmo pagamento_id 2x em série avança uma vez', async () => {
    const s = await criarSalaoComAssinatura('suspensa');
    expect(await aplicarEventoAssinatura(s.ctx, ev('mp-1-' + s.salaoId), AGORA)).toMatchObject({ resultado: 'aplicado' });
    expect(await aplicarEventoAssinatura(s.ctx, ev('mp-1-' + s.salaoId), AGORA)).toEqual({ resultado: 'sem_efeito', motivo: 'pagamento_duplicado' });
    expect(await pagamentosDe(s.assinaturaId)).toHaveLength(1);
    expect(await transicoesDe(s.assinaturaId)).toHaveLength(1);
  });

  it('mesmo pagamento_id em ativa 2x: pago_ate avança uma vez só', async () => {
    const s = await criarSalaoComAssinatura('ativa', { periodoPagoAte: new Date('2027-03-20T00:00:00Z') });
    const id = 'mp-ativa-' + s.salaoId;
    await aplicarEventoAssinatura(s.ctx, ev(id), AGORA);
    await aplicarEventoAssinatura(s.ctx, ev(id), AGORA);
    expect(iso((await lerAssinatura(s.assinaturaId)).periodoPagoAte)).toBe('2027-04-20T00:00:00.000Z');
  });

  it.each([2, 10])('mesmo pagamento_id %i vezes em paralelo: uma vez só', async (n) => {
    const s = await criarSalaoComAssinatura('ativa', { periodoPagoAte: new Date('2027-03-20T00:00:00Z') });
    const id = `mp-par-${n}-${s.salaoId}`;
    const rs = await Promise.allSettled(Array.from({ length: n }, () => aplicarEventoAssinatura(s.ctx, ev(id), AGORA)));
    expect(rs.filter((r) => r.status === 'rejected')).toEqual([]);
    const valores = rs.map((r) => (r as PromiseFulfilledResult<{ resultado: string }>).value.resultado).sort();
    expect(valores.filter((v) => v === 'aplicado')).toHaveLength(1);
    expect(valores.filter((v) => v === 'sem_efeito')).toHaveLength(n - 1);
    expect(await pagamentosDe(s.assinaturaId)).toHaveLength(1);
    expect(iso((await lerAssinatura(s.assinaturaId)).periodoPagoAte)).toBe('2027-04-20T00:00:00.000Z');
  });

  it('falha forçada após registrar o pagamento desfaz pagamento, estado e pago_ate', async () => {
    const s = await criarSalaoComAssinatura('suspensa');
    const antes = await lerAssinatura(s.assinaturaId);
    await expect(
      aplicarEventoAssinatura(s.ctx, ev('mp-falha-' + s.salaoId), AGORA, {
        aposRegistrarPagamento: async () => {
          throw new Error('falha forçada');
        },
      }),
    ).rejects.toThrow('falha forçada');
    expect(await lerAssinatura(s.assinaturaId)).toEqual(antes);
    expect(await pagamentosDe(s.assinaturaId)).toHaveLength(0);
    expect(await transicoesDe(s.assinaturaId)).toHaveLength(0);
    // reenvio posterior funciona
    expect(await aplicarEventoAssinatura(s.ctx, ev('mp-falha-' + s.salaoId), AGORA)).toMatchObject({ resultado: 'aplicado' });
  });
});
