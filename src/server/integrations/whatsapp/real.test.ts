import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ConfigWhatsAppReal } from './ambiente';
import { ErroEnvioPermanente, ErroEnvioTemporario } from './port';
import type { EnvioModelo } from './port';
import { criarWhatsAppReal } from './real';

// Contrato com servidor node:http local (D-047; sem credencial nem rede real).

const TOKEN = 'EAAG-token-ultra-secreto-1234';
const LINK = 'https://agenda.exemplo.com.br/studio/avaliar/TOKEN-SENTINELA-DO-CONVITE';
const DESTINO = '+5511987654321';
const CONFIG: ConfigWhatsAppReal = {
  accessToken: TOKEN,
  phoneNumberId: '1098765',
  versaoApi: 'v25.0',
  idioma: 'pt_BR',
  modelos: { confirmacao: 'm_conf', remarcacao: 'm_rem', cancelamento: 'm_canc', convite_avaliacao: 'm_conv' },
};
const PARAMETROS = {
  salao: 'Studio Aurora',
  servicos: 'Corte e escova',
  profissional: 'Marina',
  data: '12/12/2026',
  horario: '14:30',
  link: LINK,
};
const envio = (modelo: EnvioModelo['modelo'], extra: Partial<EnvioModelo> = {}): EnvioModelo => ({
  destinatarioE164: DESTINO,
  modelo,
  parametros: PARAMETROS,
  chaveIdempotencia: 'reserva-1:confirmacao:0',
  ...extra,
});

type Req = { metodo: string; caminho: string; cabecalhos: IncomingMessage['headers']; corpo: unknown };
type Programada = { status: number; corpo?: unknown; texto?: string; derrubar?: boolean; mudo?: boolean; local?: string };

let servidor: Server;
let urlBase: string;
let recebidas: Req[];
let fila: Programada[];
let sockets: Set<Socket>;
let alvoDoRedirect: Server;
let alvoRecebeu: number;

const OK = { status: 200, corpo: { messaging_product: 'whatsapp', contacts: [{ input: '5511987654321', wa_id: '5511987654321' }], messages: [{ id: 'wamid.HBgM' }] } };

beforeAll(async () => {
  sockets = new Set();
  alvoRecebeu = 0;
  alvoDoRedirect = createServer((_req, res) => {
    alvoRecebeu++;
    res.end('{}');
  });
  await new Promise<void>((ok) => alvoDoRedirect.listen(0, '127.0.0.1', ok));
  servidor = createServer((req, res) => {
    const partes: Buffer[] = [];
    req.on('data', (c: Buffer) => partes.push(c));
    req.on('end', () => {
      recebidas.push({
        metodo: req.method ?? '',
        caminho: req.url ?? '',
        cabecalhos: req.headers,
        corpo: JSON.parse(Buffer.concat(partes).toString('utf8')),
      });
      const p = fila.shift() ?? { status: 500 };
      if (p.derrubar) return void req.socket.destroy();
      if (p.mudo) return; // aceita a conexão e nunca responde
      res.writeHead(p.status, { 'content-type': 'application/json', ...(p.local ? { location: p.local } : {}) });
      res.end(p.texto ?? JSON.stringify(p.corpo ?? {}));
    });
  });
  servidor.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  urlBase = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});
afterAll(async () => {
  for (const s of sockets) s.destroy();
  await new Promise<void>((ok) => servidor.close(() => ok()));
  await new Promise<void>((ok) => alvoDoRedirect.close(() => ok()));
});
beforeEach(() => {
  recebidas = [];
  fila = [];
});
afterEach(() => vi.restoreAllMocks());

const porta = (timeoutMs?: number) => criarWhatsAppReal(CONFIG, { urlBase, timeoutMs });
const falha = async (p: Promise<unknown>) => (await p.then(() => null, (e: unknown) => e)) as Error & { codigo: string };

describe('CA-1/CA-2/CA-3: requisição e sucesso', () => {
  it.each([
    ['confirmacao', 'm_conf', ['Studio Aurora', 'Corte e escova', 'Marina', '12/12/2026', '14:30']],
    ['remarcacao', 'm_rem', ['Studio Aurora', 'Corte e escova', 'Marina', '12/12/2026', '14:30']],
    ['cancelamento', 'm_canc', ['Studio Aurora', 'Corte e escova', '12/12/2026', '14:30']],
    ['convite_avaliacao', 'm_conv', ['Studio Aurora', LINK]],
  ] as const)('%s: POST no caminho da Meta com Bearer, corpo e ordem corretos; devolve o id', async (modelo, nome, textos) => {
    fila.push(OK);
    const r = await porta().enviarModelo(envio(modelo));
    expect(r).toEqual({ provedorMensagemId: 'wamid.HBgM' });
    expect(recebidas).toHaveLength(1);
    const [q] = recebidas;
    expect(q.metodo).toBe('POST');
    expect(q.caminho).toBe('/v25.0/1098765/messages');
    expect(q.cabecalhos.authorization).toBe(`Bearer ${TOKEN}`);
    expect(q.cabecalhos['content-type']).toBe('application/json');
    expect(q.corpo).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '5511987654321',
      type: 'template',
      template: {
        name: nome,
        language: { code: 'pt_BR' },
        components: [{ type: 'body', parameters: textos.map((text) => ({ type: 'text', text })) }],
      },
    });
  });

  it('a chave reserva:tipo:revisao NÃO vai à Meta (corpo nem cabeçalhos)', async () => {
    fila.push(OK);
    await porta().enviarModelo(envio('confirmacao', { chaveIdempotencia: 'CHAVE-SENTINELA:confirmacao:3' }));
    expect(JSON.stringify(recebidas[0])).not.toContain('CHAVE-SENTINELA');
  });

  it('profissional vazio vai como "-"', async () => {
    fila.push(OK);
    await porta().enviarModelo(envio('confirmacao', { parametros: { ...PARAMETROS, profissional: '' } }));
    const corpo = recebidas[0].corpo as { template: { components: { parameters: { text: string }[] }[] } };
    expect(corpo.template.components[0].parameters[2].text).toBe('-');
  });
});

describe('CA-4/CA-5: classificação ponta a ponta', () => {
  it.each([[500], [502], [503]])('HTTP %i é temporário provedor_indisponivel, sem repetir', async (status) => {
    fila.push({ status, texto: 'erro html' }, OK);
    const e = await falha(porta().enviarModelo(envio('confirmacao')));
    expect(e).toBeInstanceOf(ErroEnvioTemporario);
    expect(e.codigo).toBe('provedor_indisponivel');
    expect(recebidas).toHaveLength(1);
  });

  it('HTTP 429 e 130429 são temporários limite_de_taxa, sem repetir', async () => {
    for (const p of [{ status: 429 }, { status: 400, corpo: { error: { code: 130429, message: 'x' } } }]) {
      fila = [p, OK];
      const e = await falha(porta().enviarModelo(envio('confirmacao')));
      expect(e).toBeInstanceOf(ErroEnvioTemporario);
      expect(e.codigo).toBe('limite_de_taxa');
    }
    expect(recebidas).toHaveLength(2);
  });

  it('conexão recusada é temporária `rede`', async () => {
    const e = await falha(criarWhatsAppReal(CONFIG, { urlBase: 'http://127.0.0.1:1' }).enviarModelo(envio('confirmacao')));
    expect(e).toBeInstanceOf(ErroEnvioTemporario);
    expect(e.codigo).toBe('rede');
  });

  it('conexão derrubada no meio é temporária `rede`, sem repetir', async () => {
    fila.push({ status: 200, derrubar: true }, OK);
    const e = await falha(porta().enviarModelo(envio('confirmacao')));
    expect(e).toBeInstanceOf(ErroEnvioTemporario);
    expect(e.codigo).toBe('rede');
    expect(recebidas).toHaveLength(1);
  });

  it.each([
    [131026, 'numero_invalido'],
    [132001, 'modelo_invalido'],
    [132000, 'parametros_invalidos'],
    [131049, 'nao_entregue'],
  ])('HTTP 400 com error.code %i é permanente %s', async (code, codigo) => {
    fila.push({ status: 400, corpo: { error: { code, message: 'texto da Meta' } } });
    const e = await falha(porta().enviarModelo(envio('confirmacao')));
    expect(e).toBeInstanceOf(ErroEnvioPermanente);
    expect(e.codigo).toBe(codigo);
  });

  it('CA-5: HTTP 401 com error.code 190 é temporário configuracao_invalida', async () => {
    fila.push({ status: 401, corpo: { error: { code: 190, message: 'token' } } });
    const e = await falha(porta().enviarModelo(envio('confirmacao')));
    expect(e).toBeInstanceOf(ErroEnvioTemporario);
    expect(e.codigo).toBe('configuracao_invalida');
  });

  it('2xx sem id ou com JSON ilegível é temporário resposta_invalida', async () => {
    for (const p of [{ status: 200, corpo: { messages: [] } }, { status: 200, texto: '<html>' }]) {
      fila.push(p);
      const e = await falha(porta().enviarModelo(envio('confirmacao')));
      expect(e).toBeInstanceOf(ErroEnvioTemporario);
      expect(e.codigo).toBe('resposta_invalida');
    }
  });

  it('3xx não é seguido (o token não vai a outro host): temporário resposta_inesperada', async () => {
    const alvo = `http://127.0.0.1:${(alvoDoRedirect.address() as AddressInfo).port}/roubo`;
    fila.push({ status: 307, local: alvo, texto: '' });
    const e = await falha(porta().enviarModelo(envio('confirmacao')));
    expect(e).toBeInstanceOf(ErroEnvioTemporario);
    expect(e.codigo).toBe('resposta_inesperada');
    expect(alvoRecebeu).toBe(0);
  });
});

describe('CA-6: timeout', () => {
  it('servidor que aceita e não responde: `timeout` temporário em ≤ T + margem, uma única requisição', async () => {
    fila.push({ status: 200, mudo: true }, OK);
    const T = 300;
    const t0 = performance.now();
    const e = await falha(porta(T).enviarModelo(envio('confirmacao')));
    const gasto = performance.now() - t0;
    expect(e).toBeInstanceOf(ErroEnvioTemporario);
    expect(e.codigo).toBe('timeout');
    expect(gasto).toBeGreaterThanOrEqual(T - 50);
    expect(gasto).toBeLessThan(T + 1500);
    expect(recebidas).toHaveLength(1);
  });
});

describe('CA-7: entrada inválida não toca o servidor', () => {
  it.each([
    ['telefone não brasileiro', { destinatarioE164: '+14155550123' }, 'destinatario_invalido'],
    ['telefone sem +', { destinatarioE164: '5511987654321' }, 'destinatario_invalido'],
    ['chave vazia', { chaveIdempotencia: '  ' }, 'chave_idempotencia_vazia'],
    ['modelo desconhecido', { modelo: 'promocao' as unknown as EnvioModelo['modelo'] }, 'modelo_invalido'],
    ['parâmetro ausente', { parametros: { salao: 'x' } }, 'parametro_ausente'],
  ])('%s é permanente %s', async (_nome, extra, codigo) => {
    const e = await falha(porta().enviarModelo(envio('confirmacao', extra)));
    expect(e).toBeInstanceOf(ErroEnvioPermanente);
    expect(e.codigo).toBe(codigo);
    expect(recebidas).toHaveLength(0);
  });
});

describe('CA-8: nada sensível em erro, stack, JSON ou console', () => {
  it('token, link, destinatário completo e corpo da Meta não vazam em nenhum cenário', async () => {
    const espioes = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const corpoMeta = { error: { code: 131026, message: `MENSAGEM-DA-META ${TOKEN} ${LINK}`, error_data: { details: 'DETALHE-DA-META' } } };
    const cenarios: (() => Promise<unknown>)[] = [
      ...[{ status: 500, texto: `5xx ${TOKEN}` }, { status: 429, corpo: corpoMeta }, { status: 400, corpo: corpoMeta }, { status: 401, corpo: { error: { code: 190, message: TOKEN } } }, { status: 200, texto: `lixo ${LINK}` }].map(
        (p) => () => {
          fila.push(p);
          return porta().enviarModelo(envio('convite_avaliacao'));
        },
      ),
      () => criarWhatsAppReal(CONFIG, { urlBase: 'http://127.0.0.1:1' }).enviarModelo(envio('convite_avaliacao')),
      () => {
        fila.push({ status: 200, mudo: true });
        return porta(100).enviarModelo(envio('convite_avaliacao'));
      },
      () => porta().enviarModelo(envio('convite_avaliacao', { parametros: { salao: LINK } })),
      () => porta().enviarModelo(envio('convite_avaliacao', { destinatarioE164: '+14155550123' })),
    ];
    for (const c of cenarios) {
      const e = await falha(c());
      expect(e).toBeInstanceOf(Error);
      const serializado = JSON.stringify([e.message, e.name, e.codigo, e.stack, e.cause, Object.entries(e)]);
      for (const proibido of [TOKEN, LINK, 'TOKEN-SENTINELA', 'MENSAGEM-DA-META', 'DETALHE-DA-META', '5511987654321', '987654321']) {
        expect(serializado, proibido).not.toContain(proibido);
      }
    }
    for (const e of espioes) expect(e).not.toHaveBeenCalled();
  });
});
