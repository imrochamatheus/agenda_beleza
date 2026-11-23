import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { lerConfigReal } from './ambiente';
import type { ConfigWhatsAppReal } from './ambiente';
import { criarWhatsAppReal } from './real';
import { validarEnv } from '../../env';

const TOKEN = 'TOKEN-SENTINELA-XYZ';
const LINK = 'https://x.test/avaliar/LINK-SENTINELA';
const FONE = '+5511987654321';
const config: ConfigWhatsAppReal = {
  accessToken: TOKEN, phoneNumberId: '123456', versaoApi: 'v25.0', idioma: 'pt_BR',
  modelos: { confirmacao: 'c', remarcacao: 'r', cancelamento: 'x', convite_avaliacao: 'v' },
};
type Req = { url?: string; method?: string; headers: http.IncomingHttpHeaders; body: string };
let srv: http.Server | undefined;
const recebidas: Req[] = [];
async function sobe(h: (res: http.ServerResponse) => void) {
  recebidas.length = 0;
  srv = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => { recebidas.push({ url: req.url, method: req.method, headers: req.headers, body: b }); h(res); });
  });
  await new Promise<void>((r) => srv!.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
}
afterEach(async () => { srv?.closeAllConnections(); if (srv) await new Promise((r) => srv!.close(r)); srv = undefined; });

const base = { destinatarioE164: FONE, chaveIdempotencia: 'r:confirmacao:0' };
const P = { salao: 'S', servicos: 'Sv', profissional: '', data: '12/12', horario: '10:00', itens: '10:00 Sv com A', link: LINK };

describe('tester D-047', () => {
  it('4 modelos: corpo e cabeçalhos', async () => {
    const url = await sobe((res) => { res.writeHead(200); res.end('{"messages":[{"id":"wamid.A"}]}'); });
    const w = criarWhatsAppReal(config, { urlBase: url });
    const esperado: Record<string, [string, string[]]> = {
      confirmacao: ['c', ['S', '12/12', '10:00 Sv com A']],
      remarcacao: ['r', ['S', 'Sv', '-', '12/12', '10:00']],
      cancelamento: ['x', ['S', 'Sv', '12/12', '10:00']],
      convite_avaliacao: ['v', ['S', LINK]],
    };
    for (const [m, [nome, ps]] of Object.entries(esperado)) {
      const r = await w.enviarModelo({ ...base, modelo: m as never, parametros: P });
      expect(r.provedorMensagemId).toBe('wamid.A');
      const q = recebidas.at(-1)!;
      expect(q.method).toBe('POST');
      expect(q.url).toBe('/v25.0/123456/messages');
      expect(q.headers.authorization).toBe(`Bearer ${TOKEN}`);
      const j = JSON.parse(q.body);
      expect(j.messaging_product).toBe('whatsapp');
      expect(j.to).toBe('5511987654321');
      expect(j.type).toBe('template');
      expect(j.template.name).toBe(nome);
      expect(j.template.language.code).toBe('pt_BR');
      expect(j.template.components[0].parameters.map((p: { text: string }) => p.text)).toEqual(ps);
      expect(q.body).not.toContain('r:confirmacao');
    }
  });
  it.each([
    [500, '{}', 'T'], [502, '', 'T'], [429, '{}', 'T'], [400, '{"error":{"code":130429}}', 'T'],
    [200, '{"error":1}', 'T'], [400, '{"error":{"code":131026}}', 'P'], [400, '{"error":{"code":132001}}', 'P'],
    [401, '{"error":{"code":190}}', 'T'], [500, '{"error":{"code":131026}}', 'T'], [429, '{"error":{"code":131026}}', 'T'],
    [400, '{"error":{"code":131049}}', 'P'], [400, '{"error":{"code":131057}}', 'T'], [400, '{"error":{"code":99999}}', 'P'],
    [302, '', 'T'], [401, 'lixo', 'T'], [400, '{"error":{"code":131031}}', 'T'],
  ])('erro %i %s => %s, sem vazamento, 1 chamada', async (status, corpo, tipo) => {
    const url = await sobe((res) => { res.writeHead(status, { location: 'http://127.0.0.1:1/x' }); res.end(corpo.startsWith('{"error":{') ? corpo.replace('{"error":{', '{"error":{"message":"' + TOKEN + '",') : corpo); });
    const spy = vi.spyOn(console, 'log'); const spe = vi.spyOn(console, 'error');
    const w = criarWhatsAppReal(config, { urlBase: url });
    const e = await w.enviarModelo({ ...base, modelo: 'convite_avaliacao', parametros: P }).then(() => null, (x: Error) => x);
    expect(e).not.toBeNull();
    expect(e!.name).toBe(tipo === 'T' ? 'ErroEnvioTemporario' : 'ErroEnvioPermanente');
    const ser = JSON.stringify(e, Object.getOwnPropertyNames(e)) + String(e!.stack) + e!.message + String((e as { cause?: unknown }).cause);
    for (const s of [TOKEN, LINK, '5511987654321', 'LINK-SENTINELA']) expect(ser).not.toContain(s);
    expect(spy).not.toHaveBeenCalled(); expect(spe).not.toHaveBeenCalled();
    expect(recebidas).toHaveLength(1);
  });
  it('timeout com servidor mudo', async () => {
    const url = await sobe(() => {});
    const w = criarWhatsAppReal(config, { urlBase: url, timeoutMs: 300 });
    const t = Date.now();
    const e = await w.enviarModelo({ ...base, modelo: 'confirmacao', parametros: P }).catch((x: Error) => x);
    expect((e as unknown as { codigo?: string }).codigo ?? (e as Error).message).toContain('timeout');
    expect(Date.now() - t).toBeLessThan(1500);
    expect(recebidas).toHaveLength(1);
  });
  it('entrada inválida não toca o servidor; param ausente', async () => {
    const url = await sobe((res) => { res.writeHead(200); res.end('{}'); });
    const w = criarWhatsAppReal(config, { urlBase: url });
    await expect(w.enviarModelo({ ...base, destinatarioE164: '+14155550100', modelo: 'confirmacao', parametros: P })).rejects.toMatchObject({ name: 'ErroEnvioPermanente' });
    await expect(w.enviarModelo({ ...base, chaveIdempotencia: '', modelo: 'confirmacao', parametros: P })).rejects.toMatchObject({ name: 'ErroEnvioPermanente' });
    await expect(w.enviarModelo({ ...base, modelo: 'x' as never, parametros: P })).rejects.toMatchObject({ name: 'ErroEnvioPermanente' });
    await expect(w.enviarModelo({ ...base, modelo: 'confirmacao', parametros: { salao: 'a' } })).rejects.toMatchObject({ name: 'ErroEnvioPermanente' });
    expect(recebidas).toHaveLength(0);
  });
  it('conexão recusada = temporário', async () => {
    const w = criarWhatsAppReal(config, { urlBase: 'http://127.0.0.1:1' });
    await expect(w.enviarModelo({ ...base, modelo: 'confirmacao', parametros: P })).rejects.toMatchObject({ name: 'ErroEnvioTemporario' });
  });
  it('startup nomeia todas', () => {
    const r = lerConfigReal({});
    expect(r).toEqual({ ok: false, variaveis: ['WHATSAPP_ACCESS_TOKEN','WHATSAPP_PHONE_NUMBER_ID','WHATSAPP_TEMPLATE_CANCELAMENTO','WHATSAPP_TEMPLATE_CONFIRMACAO','WHATSAPP_TEMPLATE_CONVITE_AVALIACAO','WHATSAPP_TEMPLATE_REMARCACAO'] });
    expect(lerConfigReal({ WHATSAPP_ACCESS_TOKEN: 't', WHATSAPP_PHONE_NUMBER_ID: '1', WHATSAPP_TEMPLATE_CONFIRMACAO: 'a', WHATSAPP_TEMPLATE_REMARCACAO: 'a', WHATSAPP_TEMPLATE_CANCELAMENTO: 'a', WHATSAPP_TEMPLATE_CONVITE_AVALIACAO: 'a' })).toMatchObject({ ok: true, config: { versaoApi: 'v25.0', idioma: 'pt_BR' } });
    expect(lerConfigReal({ WHATSAPP_API_VERSION: 'abc' })).toMatchObject({ ok: false });
    expect(typeof validarEnv).toBe('function');
  });
});
