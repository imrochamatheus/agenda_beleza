import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { ErroMercadoPago } from './port';
import { criarMercadoPagoReal } from './real';

const TOKEN = 'APP_USR-TOKEN-SECRETO-XYZ';
const SEGREDO = 'segredo-webhook-xyz';
const CONFIG = { accessToken: TOKEN, webhookSecret: SEGREDO, planoId: 'plano1', urlNotificacao: 'https://x.exemplo.com/api/webhooks/mercadopago' } as never;
const AGORA = new Date('2026-11-22T12:00:00Z');
const resp = (s: number) => async () => new Response('{"corpo":"BRUTO-PROVEDOR-123"}', { status: s });

describe('tester D-046: sem vazamento e webhook', () => {
  it.each([400, 401, 403, 404, 409, 422, 429, 500, 503])('status %i não vaza token nem corpo', async (s) => {
    const p = criarMercadoPagoReal(CONFIG, { fetchImpl: resp(s) as never, agora: () => AGORA, esperar: async () => {} });
    const e = await p.consultarAssinatura('abc').catch((x) => x);
    expect(e).toBeInstanceOf(ErroMercadoPago);
    const t = JSON.stringify({ m: e.message, c: String(e.cause), s: e.stack }) + JSON.stringify(e);
    expect(t).not.toContain(TOKEN);
    expect(t).not.toContain('BRUTO-PROVEDOR');
  });
  const assinar = (id: string, rid: string, ts: string, seg = SEGREDO) =>
    `ts=${ts},v1=${createHmac('sha256', seg).update(`id:${id};request-id:${rid};ts:${ts};`).digest('hex')}`;
  const val = (ts: string, extra: Record<string, string> = {}, seg = SEGREDO, q: Record<string, string> = {}) =>
    criarMercadoPagoReal(CONFIG, { agora: () => AGORA }).validarWebhook({
      cabecalhos: { 'x-request-id': 'r1', 'x-signature': assinar('123', 'r1', ts, seg), ...extra },
      consulta: { 'data.id': '123', type: 'subscription_preapproval', ...q },
      corpoBruto: '{}', corpo: {},
    } as never);
  it('aceita ts em ms e em s; rejeita segredo errado, janela, ausentes, malformada', async () => {
    const ms = AGORA.getTime();
    expect((await val(String(ms))).valida).toBe(true);
    expect((await val(String(Math.floor(ms / 1000)))).valida).toBe(true);
    expect((await val(String(ms - 300_001))).valida).toBe(false);
    expect((await val(String(ms + 300_001))).valida).toBe(false);
    expect((await val(String(ms), {}, 'errado')).valida).toBe(false);
    expect((await val(String(ms), { 'x-signature': 'ts=1,v1=abc' })).valida).toBe(false);
    expect((await val(String(ms), { 'x-signature': `ts=${ms},v1=${'a'.repeat(63)}` })).valida).toBe(false);
    expect((await val(String(ms), { 'x-request-id': '' })).valida).toBe(false);
    expect((await val(String(ms), {}, SEGREDO, { 'data.id': '124' })).valida).toBe(false);
  });
});
