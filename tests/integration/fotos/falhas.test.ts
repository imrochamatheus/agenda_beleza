import type pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { enviar } from '@/server/fotos/servico';
import { ErroDeArmazenamento } from '@/server/integrations/armazenamento/port';
import { integracoes } from '@/server/integrations/registry';
import * as transacao from '@/server/repos/transacao';

import { criarSalaoCompleto } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { TOKEN_UUID, jpegComExif, jpegPequeno } from '../../support/imagens';
import { conectar } from '../../support/sql';

import { credGestor, ctxDoGestor, fotosDe } from './apoio';
import { capturarLogs, codigoDoRedirect, encerrarArmazenamento, enviarPorHttp, prepararArmazenamento } from './apoio-servico';
import type { Armazenamento } from './apoio-servico';

// D-021 T-7: CA-18 (falhas do armazenamento e do sharp; logs sem dados) e a compensação do envio.

let c: pg.Client;
let s: SalaoCompleto;
let arm: Armazenamento;

beforeAll(async () => {
  c = await conectar();
  s = await criarSalaoCompleto();
  arm = prepararArmazenamento();
});
afterAll(async () => {
  encerrarArmazenamento(arm);
  await c.end();
});
afterEach(async () => {
  await c.query('DELETE FROM salao_foto WHERE salao_id = $1', [s.salaoId]);
  arm.limpar();
  vi.restoreAllMocks();
});

describe('falhas (CA-18)', () => {
  it('gravar lança: código falha, nenhuma linha, nenhum 5xx e nenhum detalhe interno', async () => {
    vi.spyOn(integracoes().armazenamento, 'gravar').mockRejectedValue(new ErroDeArmazenamento('disco cheio em /var/segredo'));
    const r = await enviarPorHttp(await credGestor(s), { arquivo: await jpegPequeno() });
    expect(r.status).toBe(303);
    expect(codigoDoRedirect(r)).toBe('falha');
    expect(r.headers.get('location')).not.toContain('segredo');
    expect(await fotosDe(c, s.salaoId)).toEqual([]);
    expect(arm.objetos()).toEqual([]);
  });

  it('o sharp lança erro inesperado → ilegivel, sem escrita', async () => {
    const r = await enviar(ctxDoGestor(s), {
      obterCorpo: async () => ({ ok: true, arquivo: new Uint8Array(await jpegPequeno()), alt: 'x', envio: TOKEN_UUID }),
    }, { processar: async () => ({ ok: false, erro: 'ilegivel' }) });
    expect(r).toEqual({ resultado: 'recusado', codigo: 'ilegivel' });
    expect(await fotosDe(c, s.salaoId)).toEqual([]);
    expect(arm.objetos()).toEqual([]);
  });

  it('transação que falha depois de gravar: o objeto é compensado e o erro sobe (a rota o traduz em falha)', async () => {
    const credito = await credGestor(s);
    vi.spyOn(transacao, 'emTransacao').mockRejectedValue(new Error('banco caiu'));
    const r = await enviarPorHttp(credito, { arquivo: await jpegPequeno() });
    expect(codigoDoRedirect(r)).toBe('falha');
    expect(await fotosDe(c, s.salaoId)).toEqual([]);
    expect(arm.objetos()).toEqual([]);
  });

  it('logs do envio só têm ids, códigos e tamanhos: nunca o texto alternativo, o nome do arquivo ou bytes', async () => {
    const logs = capturarLogs();
    await enviarPorHttp(await credGestor(s), { arquivo: await jpegComExif(1000, 800), alt: 'Texto alternativo secreto', nome: 'Nome Secreto Do Arquivo.jpg' });
    vi.spyOn(integracoes().armazenamento, 'gravar').mockRejectedValue(new Error('x'));
    await enviarPorHttp(await credGestor(s), { arquivo: await jpegPequeno(), alt: 'Outro texto secreto', nome: 'Outro Nome Secreto.jpg', envio: '4f2504e0-4f89-41d3-9a0c-0305e82c3301' });
    const texto = logs();
    expect(texto).toContain('foto.enviada');
    for (const proibido of ['secreto', 'Secreto', 'Nome Secreto', 'segredo-exif', 'RIFF']) expect(texto).not.toContain(proibido);
  });
});
