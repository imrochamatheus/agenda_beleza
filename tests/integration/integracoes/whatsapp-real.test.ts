import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { criarWhatsAppReal } from '@/server/integrations/whatsapp/real';
import { enviarMensagem } from '@/server/mensagens/envio';
import { encerrarPrisma } from '@/server/repos/db';

import { criarCenarioMensagem, lerMensagem, lerTentativas } from '../../support/mensagens';
import { registrar } from '../mensagens/apoio';

// D-047 CA-12: o pipeline de mensagens (D-024) com o adaptador REAL contra um stub HTTP local.

const TOKEN = 'EAAG-token-de-teste-pipeline';
const CONFIG = {
  accessToken: TOKEN,
  phoneNumberId: '1098765',
  versaoApi: 'v25.0',
  idioma: 'pt_BR',
  modelos: { confirmacao: 'm_conf', remarcacao: 'm_rem', cancelamento: 'm_canc', convite_avaliacao: 'm_conv' },
};

let servidor: Server;
let urlBase: string;
let respostas: { status: number; corpo: unknown }[];
let recebidas: unknown[];
const logs: { evento: string; campos: Record<string, unknown> }[] = [];

beforeAll(async () => {
  servidor = createServer((req, res) => {
    const partes: Buffer[] = [];
    req.on('data', (c: Buffer) => partes.push(c));
    req.on('end', () => {
      recebidas.push(JSON.parse(Buffer.concat(partes).toString('utf8')));
      const r = respostas.shift() ?? { status: 500, corpo: {} };
      res.writeHead(r.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(r.corpo));
    });
  });
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  urlBase = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((ok) => servidor.close(() => ok()));
  await encerrarPrisma();
});
beforeEach(() => {
  respostas = [];
  recebidas = [];
  logs.length = 0;
});

const enviar = (mensagemId: string, atual = 1, maxima = 5) =>
  enviarMensagem(mensagemId, { atual, maxima }, {
    whatsapp: () => criarWhatsAppReal(CONFIG, { urlBase }),
    agora: () => new Date(),
    log: (evento, campos) => logs.push({ evento, campos }),
  });

describe('CA-12: enviarMensagem com o adaptador real', () => {
  it('sucesso: enviada, com o id da Meta na mensagem e na tentativa', async () => {
    const s = await criarCenarioMensagem();
    const { mensagemId } = await registrar(s, 'confirmacao');
    respostas.push({ status: 200, corpo: { messages: [{ id: 'wamid.REAL.1' }] } });

    expect(await enviar(mensagemId)).toBe('concluida');

    const m = await lerMensagem(mensagemId);
    expect(m.estado).toBe('enviada');
    expect(m.provedorMensagemId).toBe('wamid.REAL.1');
    const t = await lerTentativas(mensagemId);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ numero: 1, resultado: 'sucesso', erroCodigo: null });
    expect(recebidas).toHaveLength(1);
    expect((recebidas[0] as { to: string }).to).toBe(s.telefone.replace(/\D/g, ''));
  });

  it('D-050 CA-43: a confirmação consolidada vai à Meta na ordem salao, data, itens', async () => {
    // 2031-03-10T12:00Z = 09:00 em São Paulo; dois itens encadeados de 30 min do mesmo profissional.
    const s = await criarCenarioMensagem({ inicio: new Date('2031-03-10T12:00:00Z'), servicos: ['Escova', 'Manicure'] });
    const { mensagemId } = await registrar(s, 'confirmacao');
    respostas.push({ status: 200, corpo: { messages: [{ id: 'wamid.REAL.CONF' }] } });

    expect(await enviar(mensagemId)).toBe('concluida');

    expect((await lerMensagem(mensagemId)).estado).toBe('enviada');
    const corpo = recebidas[0] as { template: { name: string; components: { parameters: { type: string; text: string }[] }[] } };
    expect(corpo.template.name).toBe('m_conf');
    expect(corpo.template.components[0].parameters).toEqual([
      { type: 'text', text: s.salaoNome },
      { type: 'text', text: '10/03/2031' },
      { type: 'text', text: `09:00 Escova com ${s.profissionalNome}; 09:30 Manicure com ${s.profissionalNome}` },
    ]);
  });

  it('5xx: a mensagem volta a pendente, a tentativa registra o código e o job é reagendado', async () => {
    const s = await criarCenarioMensagem();
    const { mensagemId } = await registrar(s, 'confirmacao');
    respostas.push({ status: 503, corpo: {} });

    expect(await enviar(mensagemId)).toBe('reagendar');

    const m = await lerMensagem(mensagemId);
    expect(m.estado).toBe('pendente');
    expect(m.provedorMensagemId).toBeNull();
    const t = await lerTentativas(mensagemId);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ resultado: 'falha', erroCodigo: 'provedor_indisponivel' });
    expect(recebidas).toHaveLength(1);
  });

  it('131026 (número inválido): falhou sem retentativa, com o código no registro', async () => {
    const s = await criarCenarioMensagem();
    const { mensagemId } = await registrar(s, 'confirmacao');
    respostas.push({ status: 400, corpo: { error: { code: 131026, message: 'Message undeliverable' } } });

    expect(await enviar(mensagemId)).toBe('concluida');

    const m = await lerMensagem(mensagemId);
    expect(m.estado).toBe('falhou');
    expect(m.erroCodigo).toBe('numero_invalido');
    const t = await lerTentativas(mensagemId);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ resultado: 'falha', erroCodigo: 'numero_invalido' });
    expect(recebidas).toHaveLength(1);
    expect(JSON.stringify(logs)).not.toContain(TOKEN);
  });

  it('401/190 esgotando as tentativas termina em falhou configuracao_invalida (reenviável)', async () => {
    const s = await criarCenarioMensagem();
    const { mensagemId } = await registrar(s, 'confirmacao');
    respostas.push({ status: 401, corpo: { error: { code: 190, message: 'Invalid OAuth' } } });

    expect(await enviar(mensagemId, 5, 5)).toBe('concluida');

    const m = await lerMensagem(mensagemId);
    expect(m.estado).toBe('falhou');
    expect(m.erroCodigo).toBe('configuracao_invalida');
  });
});
