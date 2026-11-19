import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { NotificacaoWebhook } from './port';
import {
  notificacaoSimulada,
  SEGREDO_WEBHOOK_SIMULADO,
  TIPOS_MP,
  validarNotificacaoSimulada,
} from './webhook-simulado';

const ID = '7f1c2b4e-9a0d-4c55-8e2b-1d3f5a6b7c8d';
const OUTRO_ID = '0e9d8c7b-6a5f-4e3d-9c2b-1a0f9e8d7c6b';
const REQ = 'b3a1f0e2-1111-4222-8333-944455556666';
const EM = new Date('2026-11-19T12:00:00.000Z');

/** Cópia profunda com alterações, para adulterar sem tocar a original. */
function com(n: NotificacaoWebhook, mudar: (c: { cabecalhos: Record<string, string>; consulta: Record<string, string>; corpo: unknown }) => void): NotificacaoWebhook {
  const c = structuredClone(n) as { cabecalhos: Record<string, string>; consulta: Record<string, string>; corpo: unknown };
  mudar(c);
  return c;
}

describe('notificacaoSimulada (formato do MP)', () => {
  it('assinatura: consulta, corpo e cabeçalhos com HMAC-SHA256 do manifesto sob o segredo documentado', () => {
    const n = notificacaoSimulada('assinatura', ID, EM, REQ);
    const ts = String(EM.getTime());
    const v1 = createHmac('sha256', 'segredo-do-webhook-simulado')
      .update(`id:${ID};request-id:${REQ};ts:${ts};`)
      .digest('hex');
    expect(SEGREDO_WEBHOOK_SIMULADO).toBe('segredo-do-webhook-simulado');
    expect(n).toEqual({
      cabecalhos: { 'x-request-id': REQ, 'x-signature': `ts=${ts},v1=${v1}` },
      consulta: { 'data.id': ID, type: 'subscription_preapproval' },
      corpo: { type: 'subscription_preapproval', action: 'updated', data: { id: ID } },
    });
  });

  it('pagamento usa o type subscription_authorized_payment', () => {
    const n = notificacaoSimulada('pagamento', ID, EM, REQ);
    expect(TIPOS_MP.pagamento).toBe('subscription_authorized_payment');
    expect(n.consulta).toEqual({ 'data.id': ID, type: 'subscription_authorized_payment' });
    expect(n.corpo).toEqual({ type: 'subscription_authorized_payment', action: 'updated', data: { id: ID } });
  });

  it('sem requestId informado, gera um UUID novo a cada notificação', () => {
    const a = notificacaoSimulada('assinatura', ID, EM);
    const b = notificacaoSimulada('assinatura', ID, EM);
    expect(a.cabecalhos['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(a.cabecalhos['x-request-id']).not.toBe(b.cabecalhos['x-request-id']);
  });
});

describe('validarNotificacaoSimulada (CA-16, parte pura)', () => {
  const assinatura = notificacaoSimulada('assinatura', ID, EM, REQ);
  const pagamento = notificacaoSimulada('pagamento', OUTRO_ID, EM, REQ);

  it('CA-16: a notificação gerada é válida, com o tipo e o recurso', () => {
    expect(validarNotificacaoSimulada(assinatura)).toEqual({ valida: true, tipo: 'assinatura', recursoId: ID });
    expect(validarNotificacaoSimulada(pagamento)).toEqual({ valida: true, tipo: 'pagamento', recursoId: OUTRO_ID });
  });

  it('CA-16: aceita a assinatura com as partes em outra ordem e com espaços', () => {
    const [ts, v1] = assinatura.cabecalhos['x-signature'].split(',');
    const n = com(assinatura, (c) => {
      c.cabecalhos['x-signature'] = ` ${v1} , ${ts} `;
    });
    expect(validarNotificacaoSimulada(n)).toEqual({ valida: true, tipo: 'assinatura', recursoId: ID });
  });

  it('CA-16: aceita corpo sem data.id e sem type (só a consulta é assinada)', () => {
    expect(validarNotificacaoSimulada(com(assinatura, (c) => (c.corpo = {})))).toEqual({
      valida: true,
      tipo: 'assinatura',
      recursoId: ID,
    });
    expect(validarNotificacaoSimulada(com(assinatura, (c) => (c.corpo = null))).valida).toBe(true);
  });

  it.each<[string, (c: { cabecalhos: Record<string, string>; consulta: Record<string, string>; corpo: unknown }) => void]>([
    ['data.id da consulta adulterado', (c) => (c.consulta['data.id'] = OUTRO_ID)],
    ['data.id do corpo adulterado', (c) => ((c.corpo as { data: { id: string } }).data.id = OUTRO_ID)],
    ['data.id adulterado na consulta e no corpo', (c) => {
      c.consulta['data.id'] = OUTRO_ID;
      (c.corpo as { data: { id: string } }).data.id = OUTRO_ID;
    }],
    ['x-request-id adulterado', (c) => (c.cabecalhos['x-request-id'] = 'outro-request')],
    ['ts trocado', (c) => (c.cabecalhos['x-signature'] = c.cabecalhos['x-signature'].replace(/ts=\d+/, 'ts=1'))],
    ['v1 adulterado (um dígito)', (c) => {
      const s = c.cabecalhos['x-signature'];
      c.cabecalhos['x-signature'] = s.slice(0, -1) + (s.endsWith('0') ? '1' : '0');
    }],
    ['v1 assinado com outro segredo', (c) => {
      const ts = String(EM.getTime());
      const v1 = createHmac('sha256', 'outro-segredo').update(`id:${ID};request-id:${REQ};ts:${ts};`).digest('hex');
      c.cabecalhos['x-signature'] = `ts=${ts},v1=${v1}`;
    }],
    ['sem x-signature', (c) => delete c.cabecalhos['x-signature']],
    ['sem x-request-id', (c) => delete c.cabecalhos['x-request-id']],
    ['x-signature vazio', (c) => (c.cabecalhos['x-signature'] = '')],
    ['x-signature sem v1', (c) => (c.cabecalhos['x-signature'] = `ts=${EM.getTime()}`)],
    ['x-signature com v1 curto', (c) => (c.cabecalhos['x-signature'] = `ts=${EM.getTime()},v1=abc`)],
    ['x-signature com ts não numérico', (c) => (c.cabecalhos['x-signature'] = c.cabecalhos['x-signature'].replace(/ts=\d+/, 'ts=abc'))],
    ['x-signature sem "="', (c) => (c.cabecalhos['x-signature'] = 'lixo')],
    ['type desconhecido', (c) => (c.consulta.type = 'payment')],
    ['type da consulta trocado para outro tipo conhecido sem mudar o corpo', (c) => (c.consulta.type = 'subscription_authorized_payment')],
    ['type do corpo diferente do da consulta', (c) => ((c.corpo as { type: string }).type = 'payment')],
    ['sem data.id na consulta', (c) => delete c.consulta['data.id']],
    ['sem type na consulta', (c) => delete c.consulta.type],
    ['data.id do corpo numérico', (c) => ((c.corpo as { data: { id: unknown } }).data.id = 123)],
  ])('CA-16: %s → { valida: false }', (_nome, mudar) => {
    expect(validarNotificacaoSimulada(com(assinatura, mudar))).toEqual({ valida: false });
  });

  it('CA-16: entrada malformada (sem cabeçalhos ou consulta) → { valida: false }, sem lançar', () => {
    expect(validarNotificacaoSimulada({} as unknown as NotificacaoWebhook)).toEqual({ valida: false });
    expect(
      validarNotificacaoSimulada({ cabecalhos: assinatura.cabecalhos } as unknown as NotificacaoWebhook),
    ).toEqual({ valida: false });
  });
});
