import { createServer, type Server } from 'node:http';
import dns from 'node:dns';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { ConfigS3 } from '@/server/integrations/armazenamento/ambiente';
import { gerarChave } from '@/server/integrations/armazenamento/chave';
import { rodarContratoDaPorta } from '@/server/integrations/armazenamento/contrato';
import { ErroDeArmazenamento } from '@/server/integrations/armazenamento/port';
import { criarArmazenamentoReal } from '@/server/integrations/armazenamento/real';

// D-021 T-2 / CA-11: servidor S3 falso em 127.0.0.1 (PUT/GET/DELETE path-style). Nenhum host externo.

type Requisicao = { metodo: string; caminho: string; cabecalhos: Record<string, string | string[] | undefined> };

let servidor: Server;
let config: ConfigS3;
const objetos = new Map<string, Buffer>();
const requisicoes: Requisicao[] = [];
let modo: 'normal' | 'quebrado' = 'normal';
const resolvidos: string[] = [];

beforeAll(async () => {
  const original = dns.lookup;
  vi.spyOn(dns, 'lookup').mockImplementation(((host: string, ...resto: unknown[]) => {
    resolvidos.push(host);
    return (original as (...a: unknown[]) => unknown)(host, ...resto);
  }) as typeof dns.lookup);

  servidor = createServer((req, res) => {
    const partes: Buffer[] = [];
    req.on('data', (p: Buffer) => partes.push(p));
    req.on('end', () => {
      requisicoes.push({ metodo: req.method ?? '', caminho: req.url ?? '', cabecalhos: req.headers });
      if (modo === 'quebrado') {
        res.writeHead(503, { 'content-type': 'application/xml' });
        res.end('<Error><Code>ServiceUnavailable</Code></Error>');
        return;
      }
      const chave = decodeURIComponent((req.url ?? '').split('?')[0]);
      if (req.method === 'PUT') {
        objetos.set(chave, Buffer.concat(partes));
        res.writeHead(200, { etag: '"x"' });
        res.end();
      } else if (req.method === 'GET') {
        const o = objetos.get(chave);
        if (!o) {
          res.writeHead(404, { 'content-type': 'application/xml' });
          res.end('<?xml version="1.0"?><Error><Code>NoSuchKey</Code><Message>x</Message></Error>');
          return;
        }
        res.writeHead(200, { 'content-length': o.length });
        res.end(o);
      } else if (req.method === 'DELETE') {
        objetos.delete(chave);
        res.writeHead(204);
        res.end();
      } else {
        res.writeHead(405);
        res.end();
      }
    });
  });
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  const { port } = servidor.address() as AddressInfo;
  config = {
    endpoint: `http://127.0.0.1:${port}`,
    regiao: 'us-east-1',
    bucket: 'bucket-teste',
    accessKeyId: 'AKIATESTE',
    secretAccessKey: 'segredo-teste',
    urlPublica: null,
    pathStyle: true,
  };
});

afterAll(async () => {
  vi.restoreAllMocks();
  await new Promise((ok) => servidor.close(ok));
});

describe('adaptador real contra o servidor S3 falso: contrato da porta (CA-11)', () => {
  rodarContratoDaPorta(() => criarArmazenamentoReal(config));
});

describe('adaptador real contra o servidor S3 falso (CA-11)', () => {
  it('usa path-style, nunca lista e grava com Content-Type image/webp e sem ACL', async () => {
    modo = 'normal';
    requisicoes.length = 0;
    const porta = criarArmazenamentoReal(config);
    const chave = gerarChave();
    await porta.gravar(chave, new Uint8Array([1, 2, 3]), 'image/webp');
    await porta.ler(chave);
    await porta.remover(chave);
    expect(requisicoes.map((r) => `${r.metodo} ${r.caminho.split('?')[0]}`)).toEqual([
      `PUT /bucket-teste/${chave}`,
      `GET /bucket-teste/${chave}`,
      `DELETE /bucket-teste/${chave}`,
    ]);
    expect(requisicoes.every((r) => !r.caminho.includes('list-type') && !r.caminho.includes('?prefix'))).toBe(true);
    expect(requisicoes[0].cabecalhos['content-type']).toBe('image/webp');
    expect(requisicoes[0].cabecalhos['x-amz-acl']).toBeUndefined();
  });

  it('5xx do servidor vira ErroDeArmazenamento sem credenciais na mensagem', async () => {
    modo = 'quebrado';
    const porta = criarArmazenamentoReal(config);
    const falha = await porta.gravar(gerarChave(), new Uint8Array([1]), 'image/webp').catch((e) => e);
    expect(falha).toBeInstanceOf(ErroDeArmazenamento);
    expect(String(falha.message)).not.toContain('segredo-teste');
    modo = 'normal';
  });

  it('nenhum host que não seja loopback foi resolvido', () => {
    expect(resolvidos.filter((h) => h !== '127.0.0.1' && h !== 'localhost')).toEqual([]);
  });
});
