import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { NotificacaoWebhook } from './port';
import { JANELA_REPLAY_MS, validarWebhookReal } from './webhook';

const SEGREDO = 'segredo-do-app';
const AGORA = new Date('2026-11-22T12:00:00.000Z');

function assinar(segredo: string, manifesto: string): string {
  return createHmac('sha256', segredo).update(manifesto).digest('hex');
}

function notificacao(o: { id?: string; reqId?: string; ts?: string; tipo?: string; segredo?: string; corpo?: unknown } = {}): NotificacaoWebhook & { cabecalhos: Record<string, string>; consulta: Record<string, string> } {
  const id = o.id ?? 'abc123';
  const reqId = o.reqId ?? 'req-1';
  const ts = o.ts ?? String(AGORA.getTime());
  const tipo = o.tipo ?? 'subscription_preapproval';
  return {
    cabecalhos: { 'x-request-id': reqId, 'x-signature': `ts=${ts},v1=${assinar(o.segredo ?? SEGREDO, `id:${id};request-id:${reqId};ts:${ts};`)}` },
    consulta: { 'data.id': id, type: tipo },
    corpo: o.corpo ?? { type: tipo, data: { id } },
  };
}

const valida = (n: NotificacaoWebhook, agora = AGORA) => validarWebhookReal(n, { segredo: SEGREDO, agora });

describe('validarWebhookReal (CA-2)', () => {
  it('assinatura correta dentro da janela: válida, com tipo e recursoId', () => {
    expect(valida(notificacao())).toEqual({ valida: true, tipo: 'assinatura', recursoId: 'abc123' });
    expect(valida(notificacao({ tipo: 'subscription_authorized_payment' }))).toEqual({
      valida: true,
      tipo: 'pagamento',
      recursoId: 'abc123',
    });
  });

  it('segredo errado, v1 alterado, outro data.id ou outro x-request-id: inválida', () => {
    expect(valida(notificacao({ segredo: 'outro' }))).toEqual({ valida: false });
    const n = notificacao();
    const v1 = n.cabecalhos['x-signature'].split('v1=')[1];
    const adulterada = { ...n, cabecalhos: { ...n.cabecalhos, 'x-signature': n.cabecalhos['x-signature'].replace(v1, `${v1.slice(0, 63)}${v1.endsWith('0') ? '1' : '0'}`) } };
    expect(valida(adulterada)).toEqual({ valida: false });
    expect(valida({ ...n, consulta: { ...n.consulta, 'data.id': 'zzz' }, corpo: { data: { id: 'zzz' } } })).toEqual({ valida: false });
    expect(valida({ ...n, cabecalhos: { ...n.cabecalhos, 'x-request-id': 'outro' } })).toEqual({ valida: false });
  });

  it('CA-2b: janela de 5 min inclusive, nos dois sentidos', () => {
    expect(JANELA_REPLAY_MS).toBe(300_000);
    for (const delta of [-JANELA_REPLAY_MS, JANELA_REPLAY_MS]) {
      const ts = String(AGORA.getTime() + delta);
      expect(valida(notificacao({ ts })).valida).toBe(true);
      expect(valida(notificacao({ ts: String(AGORA.getTime() + delta + Math.sign(delta) * 1000) })).valida).toBe(false);
    }
  });

  it('CA-2e: ts em segundos (10 dígitos) é aceito, com o manifest do ts bruto e a mesma janela', () => {
    const seg = String(Math.floor(AGORA.getTime() / 1000));
    expect(valida(notificacao({ ts: seg })).valida).toBe(true);
    expect(valida(notificacao({ ts: String(Number(seg) - 301) })).valida).toBe(false);
  });

  it('CA-2e: data.id com maiúsculas confere se o MP assinou a versão em minúsculas; recursoId é o recebido', () => {
    const n = notificacao({ id: 'ABC123' });
    expect(valida(n)).toEqual({ valida: true, tipo: 'assinatura', recursoId: 'ABC123' });
    const minus = notificacao({ id: 'abc123' });
    const cabecalhos = minus.cabecalhos;
    const r = valida({ cabecalhos, consulta: { 'data.id': 'ABC123', type: 'subscription_preapproval' }, corpo: {} });
    expect(r).toEqual({ valida: true, tipo: 'assinatura', recursoId: 'ABC123' });
    expect(valida({ cabecalhos, consulta: { 'data.id': 'ABC124', type: 'subscription_preapproval' }, corpo: {} }).valida).toBe(false);
  });

  it('CA-2c: entradas malformadas retornam inválida sem lançar', () => {
    const n = notificacao();
    const sem = (c: 'x-signature' | 'x-request-id') => {
      const { [c]: _omitido, ...resto } = n.cabecalhos;
      void _omitido;
      return { ...n, cabecalhos: resto as typeof n.cabecalhos };
    };
    expect(valida(sem('x-signature')).valida).toBe(false);
    expect(valida(sem('x-request-id')).valida).toBe(false);
    expect(valida({ ...n, consulta: { type: n.consulta.type } as never }).valida).toBe(false);
    expect(valida({ ...n, consulta: { 'data.id': 'abc123' } as never }).valida).toBe(false);
    expect(valida({ ...n, consulta: { ...n.consulta, type: 'payment' } }).valida).toBe(false);
    for (const x of ['ts=abc,v1=' + 'a'.repeat(64), `ts=${AGORA.getTime()},v1=zz`, `ts=${AGORA.getTime()},v1=${'a'.repeat(62)}`, 'lixo', `ts=${AGORA.getTime()}`, '']) {
      expect(valida({ ...n, cabecalhos: { ...n.cabecalhos, 'x-signature': x } }).valida).toBe(false);
    }
    expect(valida({ ...n, corpo: { type: 'subscription_preapproval', data: { id: 'outro' } } }).valida).toBe(false);
    expect(valida({ ...n, corpo: { type: 'subscription_authorized_payment', data: { id: 'abc123' } } }).valida).toBe(false);
    expect(valida({ ...n, corpo: { data: { id: { x: 1 } } } }).valida).toBe(false);
    expect(valida({ cabecalhos: undefined, consulta: undefined, corpo: null } as never).valida).toBe(false);
  });

  it('corpo sem data.id ou numérico igual ao da query é aceito; corpoBruto é ignorado (CA-2d)', () => {
    const n = notificacao({ id: '123456' });
    expect(valida({ ...n, corpo: {} }).valida).toBe(true);
    expect(valida({ ...n, corpo: null }).valida).toBe(true);
    expect(valida({ ...n, corpo: { data: { id: 123456 } } }).valida).toBe(true);
    for (const corpoBruto of [undefined, '{"data":{"id":"123456"}}', '{  "lixo": 1 }']) {
      expect(valida({ ...n, corpoBruto })).toEqual({ valida: true, tipo: 'assinatura', recursoId: '123456' });
    }
  });
});
