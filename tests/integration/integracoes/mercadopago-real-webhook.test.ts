import { createHmac } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';

import { criarMercadoPagoReal } from '@/server/integrations/mercadopago/real';
import { encerrarPrisma } from '@/server/repos/db';

import { lerAssinatura, pagamentosDe } from '../../support/assinatura';
import { AGORA, enviar, eventoPorChave, mp, novaChave, salaoComMp } from '../assinatura/apoio-webhook';

// D-046 CA-13: webhook assinado com o segredo configurado, processado pela D-041 com o adaptador REAL
// (o GET de consulta vai a um stub local por `fetchImpl`; sem rede e sem credencial real).

afterAll(async () => {
  await encerrarPrisma();
});

const SEGREDO = 'segredo-real-de-teste';

function assinada(dataId: string, tipo: string, segredo: string, ts = String(AGORA.getTime())) {
  const requestId = novaChave();
  const v1 = createHmac('sha256', segredo).update(`id:${dataId};request-id:${requestId};ts:${ts};`).digest('hex');
  return {
    cabecalhos: { 'x-request-id': requestId, 'x-signature': `ts=${ts},v1=${v1}` },
    consulta: { 'data.id': dataId, type: tipo },
    corpo: { type: tipo, action: 'updated', data: { id: dataId } },
  };
}

describe('CA-13: webhook real assinado × D-041', () => {
  it('aceita e processa o pagamento aprovado; com segredo errado rejeita e persiste a rejeição', async () => {
    const s = await salaoComMp('suspensa');
    const { pagamentoId } = await mp.aprovarCobranca(s.simId, { em: AGORA });
    const sim = await mp.consultarPagamento(pagamentoId);
    const requisicoes: string[] = [];
    const fetchImpl = (async (url: string) => {
      requisicoes.push(url);
      return new Response(
        JSON.stringify({
          id: pagamentoId,
          preapproval_id: s.simId,
          status: 'processed',
          transaction_amount: (sim.valorCentavos / 100).toFixed(2),
          debit_date: sim.ocorridoEm.toISOString(),
          payment: { status: 'approved' },
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const real = criarMercadoPagoReal(
      { accessToken: 'tok', webhookSecret: SEGREDO, planoId: 'pl' },
      { urlBase: 'http://stub.local', fetchImpl, agora: () => AGORA },
    );

    const errada = assinada(pagamentoId, 'subscription_authorized_payment', 'segredo-errado');
    const rejeitada = await enviar(errada, { mp: real });
    expect(rejeitada.status).toBe(401);
    const [linha] = await eventoPorChave(errada.cabecalhos['x-request-id']);
    expect([linha.origemValida, linha.resultado]).toEqual([false, 'rejeitado']);
    expect(requisicoes).toEqual([]);
    expect(await pagamentosDe(s.assinaturaId)).toHaveLength(0);

    const boa = assinada(pagamentoId, 'subscription_authorized_payment', SEGREDO);
    const r = await enviar(boa, { mp: real });
    expect(r.status).toBe(200);
    expect(requisicoes).toEqual([`http://stub.local/authorized_payments/${pagamentoId}`]);
    expect((await eventoPorChave(boa.cabecalhos['x-request-id']))[0].resultado).toBe('processado');
    expect(await pagamentosDe(s.assinaturaId)).toHaveLength(1);
    expect((await lerAssinatura(s.assinaturaId)).estado).not.toBe('suspensa');
  });

  it('ts fora da janela de 5 min é rejeitado mesmo com a assinatura correta', async () => {
    const s = await salaoComMp('suspensa');
    const { pagamentoId } = await mp.aprovarCobranca(s.simId, { em: AGORA });
    const real = criarMercadoPagoReal({ accessToken: 'tok', webhookSecret: SEGREDO, planoId: 'pl' }, { agora: () => AGORA });
    const velha = assinada(pagamentoId, 'subscription_authorized_payment', SEGREDO, String(AGORA.getTime() - 6 * 60_000));
    expect((await enviar(velha, { mp: real })).status).toBe(401);
    expect(await pagamentosDe(s.assinaturaId)).toHaveLength(0);
  });
});
