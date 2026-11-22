import { createHmac } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  ErroMercadoPago,
  ErroProvedor,
  OPERACOES_MP,
  OperacaoInvalidaNoProvedor,
  ProvedorNaoSuportaAdiamento,
  RecursoNaoEncontradoNoProvedor,
} from './port';
import { criarMercadoPagoReal } from './real';

// Contrato com servidor node:http local (D-046; sem credencial nem rede real).

const TOKEN = 'APP_USR-token-ultra-secreto';
const SEGREDO = 'segredo-webhook-ultra';
const SALAO = '6f1c2c0e-1b2a-4c3d-8e4f-5a6b7c8d9e0f';
const AGORA = new Date('2026-11-22T12:00:00.000Z');
const CONFIG = { accessToken: TOKEN, webhookSecret: SEGREDO, planoId: 'plano-79' };

type Req = { metodo: string; caminho: string; cabecalhos: IncomingMessage['headers']; corpo: unknown };
type Programada = { status: number; corpo?: unknown; texto?: string; derrubar?: boolean; atrasoMs?: number };

let servidor: Server;
let urlBase: string;
let recebidas: Req[];
let fila: Programada[];

beforeAll(async () => {
  servidor = createServer((req, res) => {
    const partes: Buffer[] = [];
    req.on('data', (c: Buffer) => partes.push(c));
    req.on('end', () => {
      const bruto = Buffer.concat(partes).toString('utf8');
      recebidas.push({
        metodo: req.method ?? '',
        caminho: req.url ?? '',
        cabecalhos: req.headers,
        corpo: bruto === '' ? undefined : JSON.parse(bruto),
      });
      const p = fila.shift() ?? { status: 500 };
      if (p.derrubar) {
        req.socket.destroy();
        return;
      }
      setTimeout(() => {
        res.writeHead(p.status, { 'content-type': 'application/json' });
        res.end(p.texto ?? JSON.stringify(p.corpo ?? {}));
      }, p.atrasoMs ?? 0);
    });
  });
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  urlBase = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((ok) => servidor.close(() => ok())));
beforeEach(() => {
  recebidas = [];
  fila = [];
});

const porta = (extra: Parameters<typeof criarMercadoPagoReal>[1] = {}) =>
  criarMercadoPagoReal(CONFIG, { urlBase, agora: () => AGORA, esperar: async () => {}, ...extra });

const PRE = (o: Record<string, unknown> = {}) => ({
  id: 'ab12',
  status: 'authorized',
  external_reference: SALAO,
  init_point: 'https://www.mercadopago.com.br/subscriptions/checkout?preapproval_id=ab12',
  date_created: '2026-11-01T10:00:00.000-03:00',
  next_payment_date: '2026-12-01T10:00:00.000-03:00',
  auto_recurring: { transaction_amount: '79.00' },
  ...o,
});
const ENTRADA = { salaoId: SALAO, emailPagador: 'g@exemplo.com', urlRetorno: 'https://a.com.br/assinatura' };

describe('estrutura', () => {
  it('expõe exatamente os métodos da porta', () => {
    expect(Object.keys(porta()).sort()).toEqual([...OPERACOES_MP, 'validarWebhook'].sort());
  });
});

describe('CA-1: criar, consultar e cancelar', () => {
  it('criarAssinatura: POST /preapproval com Authorization, X-Idempotency-Key e o corpo da estratégia', async () => {
    fila.push({ status: 201, corpo: PRE({ status: 'pending' }) });
    const r = await porta({ urlNotificacao: 'https://a.com.br/api/webhooks/mercadopago' }).criarAssinatura(ENTRADA);
    expect(r).toEqual({ assinaturaId: 'ab12', urlCheckout: PRE().init_point });
    const [q] = recebidas;
    expect([q.metodo, q.caminho]).toEqual(['POST', '/preapproval']);
    expect(q.cabecalhos.authorization).toBe(`Bearer ${TOKEN}`);
    expect(q.cabecalhos['content-type']).toBe('application/json');
    expect(q.cabecalhos['x-idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(q.corpo).toMatchObject({
      preapproval_plan_id: 'plano-79',
      external_reference: SALAO,
      payer_email: 'g@exemplo.com',
      back_url: 'https://a.com.br/assinatura',
      notification_url: 'https://a.com.br/api/webhooks/mercadopago',
    });
    expect(JSON.stringify(q.corpo)).not.toMatch(/card/i);
  });

  it('CA-8: duas criações usam chaves distintas; a repetição em 429 usa a mesma', async () => {
    fila.push({ status: 201, corpo: PRE() }, { status: 201, corpo: PRE() });
    await porta().criarAssinatura(ENTRADA);
    await porta().criarAssinatura(ENTRADA);
    expect(recebidas[0].cabecalhos['x-idempotency-key']).not.toBe(recebidas[1].cabecalhos['x-idempotency-key']);

    recebidas = [];
    fila.push({ status: 429 }, { status: 201, corpo: PRE() });
    await porta().criarAssinatura(ENTRADA);
    expect(recebidas).toHaveLength(2);
    expect(recebidas[0].cabecalhos['x-idempotency-key']).toBe(recebidas[1].cabecalhos['x-idempotency-key']);
  });

  it('CA-8: conexão derrubada na 1ª tentativa repete com a mesma chave; 5xx não repete', async () => {
    fila.push({ status: 0, derrubar: true }, { status: 201, corpo: PRE() });
    await porta().criarAssinatura(ENTRADA);
    expect(recebidas).toHaveLength(2);
    expect(recebidas[0].cabecalhos['x-idempotency-key']).toBe(recebidas[1].cabecalhos['x-idempotency-key']);

    recebidas = [];
    fila.push({ status: 503 }, { status: 201, corpo: PRE() });
    await expect(porta().criarAssinatura(ENTRADA)).rejects.toBeInstanceOf(ErroProvedor);
    expect(recebidas).toHaveLength(1);
  });

  it('criarAssinatura: entrada inválida não faz HTTP; init_point http ou ausente é ErroProvedor', async () => {
    await expect(porta().criarAssinatura({ ...ENTRADA, emailPagador: 'x' })).rejects.toBeInstanceOf(OperacaoInvalidaNoProvedor);
    expect(recebidas).toHaveLength(0);
    for (const corpo of [PRE({ init_point: 'http://x.com' }), PRE({ init_point: undefined }), { sem: 'id' }]) {
      fila.push({ status: 201, corpo });
      await expect(porta().criarAssinatura(ENTRADA)).rejects.toBeInstanceOf(ErroProvedor);
    }
  });

  it('consultarAssinatura: GET /preapproval/{id} mapeado', async () => {
    fila.push({ status: 200, corpo: PRE() });
    const a = await porta().consultarAssinatura('ab12');
    expect([recebidas[0].metodo, recebidas[0].caminho]).toEqual(['GET', '/preapproval/ab12']);
    expect(recebidas[0].cabecalhos.authorization).toBe(`Bearer ${TOKEN}`);
    expect(a).toEqual({
      id: 'ab12',
      salaoId: SALAO,
      estado: 'autorizada',
      valorCentavos: 7900,
      autorizadaEm: new Date('2026-11-01T13:00:00.000Z'),
      proximaCobrancaEm: new Date('2026-12-01T13:00:00.000Z'),
      canceladaEm: null,
    });
  });

  it('cancelarAssinatura: PUT /preapproval/{id} {status: cancelled}', async () => {
    fila.push({ status: 200, corpo: PRE({ status: 'cancelled' }) });
    await porta().cancelarAssinatura('ab12');
    expect([recebidas[0].metodo, recebidas[0].caminho, recebidas[0].corpo]).toEqual(['PUT', '/preapproval/ab12', { status: 'cancelled' }]);
  });
});

describe('CA-1b: consultarPagamento', () => {
  const PAG = (o: Record<string, unknown>) => ({
    id: 9,
    preapproval_id: 'ab12',
    status: 'processed',
    transaction_amount: 79,
    debit_date: '2026-12-01T13:00:00.000Z',
    payment: { status: 'approved' },
    ...o,
  });

  it('processed/approved, rejected e scheduled', async () => {
    fila.push({ status: 200, corpo: PAG({}) }, { status: 200, corpo: PAG({ payment: { status: 'rejected' } }) }, { status: 200, corpo: PAG({ status: 'scheduled', payment: null }) });
    expect(await porta().consultarPagamento('9')).toMatchObject({ id: '9', assinaturaId: 'ab12', status: 'aprovado', valorCentavos: 7900 });
    expect(recebidas[0].caminho).toBe('/authorized_payments/9');
    expect((await porta().consultarPagamento('9')).status).toBe('recusado');
    await expect(porta().consultarPagamento('9')).rejects.toBeInstanceOf(ErroProvedor);
  });
});

describe('CA-5: adiarProximaCobranca', () => {
  const NOVA = new Date('2027-01-10T12:00:00.000Z');

  it('PUT aceito, mas o GET devolve a data antiga: ProvedorNaoSuportaAdiamento', async () => {
    fila.push({ status: 200, corpo: PRE() }, { status: 200, corpo: PRE() });
    const erro = await porta().adiarProximaCobranca('ab12', NOVA).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ProvedorNaoSuportaAdiamento);
    expect(erro).toBeInstanceOf(ErroMercadoPago);
    expect(erro).toMatchObject({ codigo: 'adiamento_nao_suportado' });
    expect(recebidas.map((r) => r.metodo)).toEqual(['PUT', 'GET']);
    expect(recebidas[0].corpo).toEqual({ next_payment_date: NOVA.toISOString() });
  });

  it('data refletida (±60 s) resolve; 61 s de diferença falha; sem data falha', async () => {
    fila.push({ status: 200, corpo: PRE() }, { status: 200, corpo: PRE({ next_payment_date: '2027-01-10T12:00:59.000Z' }) });
    await expect(porta().adiarProximaCobranca('ab12', NOVA)).resolves.toBeUndefined();
    fila.push({ status: 200, corpo: PRE() }, { status: 200, corpo: PRE({ next_payment_date: '2027-01-10T12:01:01.000Z' }) });
    await expect(porta().adiarProximaCobranca('ab12', NOVA)).rejects.toBeInstanceOf(ProvedorNaoSuportaAdiamento);
    fila.push({ status: 200, corpo: PRE() }, { status: 200, corpo: PRE({ next_payment_date: null }) });
    await expect(porta().adiarProximaCobranca('ab12', NOVA)).rejects.toBeInstanceOf(ProvedorNaoSuportaAdiamento);
  });

  it('PUT 400 de data: ProvedorNaoSuportaAdiamento (sem GET); 404 e 503 seguem a tabela', async () => {
    fila.push({ status: 400, corpo: { message: 'invalid' } });
    await expect(porta().adiarProximaCobranca('ab12', NOVA)).rejects.toBeInstanceOf(ProvedorNaoSuportaAdiamento);
    expect(recebidas).toHaveLength(1);
    fila.push({ status: 404 });
    await expect(porta().adiarProximaCobranca('ab12', NOVA)).rejects.toBeInstanceOf(RecursoNaoEncontradoNoProvedor);
    fila.push({ status: 503 });
    await expect(porta().adiarProximaCobranca('ab12', NOVA)).rejects.toBeInstanceOf(ErroProvedor);
  });

  it('data passada, igual a agora ou inválida: OperacaoInvalidaNoProvedor sem HTTP', async () => {
    for (const d of [new Date('2026-11-01T00:00:00Z'), AGORA, new Date('x'), 'amanha' as never]) {
      await expect(porta().adiarProximaCobranca('ab12', d)).rejects.toBeInstanceOf(OperacaoInvalidaNoProvedor);
    }
    expect(recebidas).toHaveLength(0);
  });
});

describe('CA-6: urlAtualizarMeioPagamento', () => {
  it('authorized devolve o init_point', async () => {
    fila.push({ status: 200, corpo: PRE() });
    expect(await porta().urlAtualizarMeioPagamento('ab12')).toBe(PRE().init_point);
  });

  it('cancelled é OperacaoInvalida; sem init_point ou http é ErroProvedor', async () => {
    fila.push({ status: 200, corpo: PRE({ status: 'cancelled' }) });
    await expect(porta().urlAtualizarMeioPagamento('ab12')).rejects.toBeInstanceOf(OperacaoInvalidaNoProvedor);
    for (const init_point of [undefined, 'http://x.com/y']) {
      fila.push({ status: 200, corpo: PRE({ init_point }) });
      await expect(porta().urlAtualizarMeioPagamento('ab12')).rejects.toBeInstanceOf(ErroProvedor);
    }
  });
});

describe('CA-9: cancelamento idempotente', () => {
  it('PUT 400 + GET cancelled resolve', async () => {
    fila.push({ status: 400 }, { status: 200, corpo: PRE({ status: 'cancelled' }) });
    await expect(porta().cancelarAssinatura('ab12')).resolves.toBeUndefined();
    expect(recebidas.map((r) => r.metodo)).toEqual(['PUT', 'GET']);
  });

  it('PUT 422 + GET authorized lança OperacaoInvalida; 404 é nao_encontrado; GET com falha propaga', async () => {
    fila.push({ status: 422 }, { status: 200, corpo: PRE() });
    await expect(porta().cancelarAssinatura('ab12')).rejects.toBeInstanceOf(OperacaoInvalidaNoProvedor);
    fila.push({ status: 404 });
    await expect(porta().cancelarAssinatura('ab12')).rejects.toBeInstanceOf(RecursoNaoEncontradoNoProvedor);
    fila.push({ status: 400 }, { status: 404 });
    await expect(porta().cancelarAssinatura('ab12')).rejects.toBeInstanceOf(RecursoNaoEncontradoNoProvedor);
  });
});

describe('CA-7: erros e segredos', () => {
  it.each([
    [404, RecursoNaoEncontradoNoProvedor],
    [400, OperacaoInvalidaNoProvedor],
    [422, OperacaoInvalidaNoProvedor],
    [401, ErroProvedor],
    [403, ErroProvedor],
  ])('GET com %s', async (status, classe) => {
    fila.push({ status, corpo: { message: `segredo ${TOKEN}`, cause: [] } });
    const erro = (await porta().consultarAssinatura('ab12').catch((e: unknown) => e)) as Error;
    expect(erro).toBeInstanceOf(classe);
    expect(JSON.stringify([erro.message, erro.name, erro.cause, erro.stack])).not.toContain(TOKEN);
    expect(erro.message).not.toContain('segredo');
  });

  it('429 e 5xx persistentes, corpo não JSON e conexão recusada são ErroProvedor; sem vazar token', async () => {
    fila.push({ status: 429 }, { status: 429 }, { status: 429 });
    await expect(porta().consultarAssinatura('ab12')).rejects.toBeInstanceOf(ErroProvedor);
    fila.push({ status: 200, texto: '<html>' });
    await expect(porta().consultarAssinatura('ab12')).rejects.toBeInstanceOf(ErroProvedor);
    const morta = criarMercadoPagoReal(CONFIG, { urlBase: 'http://127.0.0.1:1', esperar: async () => {} });
    const erro = (await morta.consultarAssinatura('ab12').catch((e: unknown) => e)) as Error;
    expect(erro).toBeInstanceOf(ErroProvedor);
    expect(JSON.stringify([erro.message, erro.cause, erro.stack])).not.toContain(TOKEN);
  });

  it('timeout real: servidor lento vira ErroProvedor', async () => {
    fila.push({ status: 200, corpo: PRE(), atrasoMs: 300 });
    const lenta = porta({ timeoutMs: 50 });
    await expect(lenta.cancelarAssinatura('ab12')).rejects.toBeInstanceOf(ErroProvedor);
  });

  it('CA-8: GET 503, 503, 200 resolve em 3 requisições; 503 x3 falha em 3', async () => {
    fila.push({ status: 503 }, { status: 503 }, { status: 200, corpo: PRE() });
    await porta().consultarAssinatura('ab12');
    expect(recebidas).toHaveLength(3);
    recebidas = [];
    fila.push({ status: 503 }, { status: 503 }, { status: 503 });
    await expect(porta().consultarAssinatura('ab12')).rejects.toBeInstanceOf(ErroProvedor);
    expect(recebidas).toHaveLength(3);
  });

  it('CA-8: PUT não repete', async () => {
    fila.push({ status: 503 }, { status: 200, corpo: PRE() });
    await expect(porta().cancelarAssinatura('ab12')).rejects.toBeInstanceOf(ErroProvedor);
    expect(recebidas).toHaveLength(1);
  });
});

describe('CA-11: ids', () => {
  it.each(['a/b', '..', 'a b', 'a'.repeat(65), '../../x'])('%j não chega ao servidor', async (id) => {
    const p = porta();
    for (const chamada of [
      () => p.consultarAssinatura(id),
      () => p.consultarPagamento(id),
      () => p.cancelarAssinatura(id),
      () => p.adiarProximaCobranca(id, new Date('2027-01-10T12:00:00Z')),
      () => p.urlAtualizarMeioPagamento(id),
    ]) {
      await expect(chamada()).rejects.toBeInstanceOf(RecursoNaoEncontradoNoProvedor);
    }
    expect(recebidas).toHaveLength(0);
  });
});

describe('validarWebhook', () => {
  it('usa o segredo da config e o relógio injetado; segredo errado é inválido', async () => {
    const ts = String(AGORA.getTime());
    const assinar = (segredo: string) =>
      `ts=${ts},v1=${createHmac('sha256', segredo).update(`id:ab12;request-id:r1;ts:${ts};`).digest('hex')}`;
    const montar = (segredo: string) => ({
      cabecalhos: { 'x-request-id': 'r1', 'x-signature': assinar(segredo) },
      consulta: { 'data.id': 'ab12', type: 'subscription_preapproval' },
      corpo: { data: { id: 'ab12' } },
    });
    expect(await porta().validarWebhook(montar(SEGREDO))).toEqual({ valida: true, tipo: 'assinatura', recursoId: 'ab12' });
    expect(await porta().validarWebhook(montar('errado'))).toEqual({ valida: false });
    expect(await porta({ agora: () => new Date(AGORA.getTime() + 301_000) }).validarWebhook(montar(SEGREDO))).toEqual({ valida: false });
  });
});
