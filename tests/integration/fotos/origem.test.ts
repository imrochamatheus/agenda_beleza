import type pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { tratarEnvio } from '@/server/fotos/envio-http';
import { enviarFoto } from '@/server/fotos/fotos.acao';
import { CODIGOS_ENVIO } from '@/server/fotos/tipos';

import { criarSalaoCompleto } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { jpegPequeno } from '../../support/imagens';
import { conectar } from '../../support/sql';

import { credGestor, fotosDe } from './apoio';
import { APP_URL, codigoDoRedirect, encerrarArmazenamento, enviarPorHttp, prepararArmazenamento, requisicaoDeEnvio } from './apoio-servico';
import type { Armazenamento } from './apoio-servico';

// D-021 T-7: CA-12 (Origin contra APP_URL; 303 com código) e CA-14 (tratarEnvio chama executar).

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
});

describe('Origin (CA-12)', () => {
  it.each([['https://atacante.test'], [null], ['null'], ['http://localhost:3001'], ['http://localhost:3000/']])('Origin %s → 403, sem executar e sem escrita', async (origem) => {
    const cred = await credGestor(s);
    let chamou = false;
    const req = await requisicaoDeEnvio({ arquivo: await jpegPequeno() }, origem);
    const r = await tratarEnvio(req, {
      executar: async (i) => {
        chamou = true;
        return enviarFoto.executar(cred, i);
      },
      appUrl: APP_URL,
    });
    expect(r.status).toBe(403);
    expect(r.headers.get('content-type')).toContain('text/plain');
    expect(await r.text()).toContain('APP_URL');
    expect(chamou).toBe(false);
    expect(await fotosDe(c, s.salaoId)).toEqual([]);
    expect(arm.objetos()).toEqual([]);
  });

  it('Origin igual à origem de APP_URL → envio segue', async () => {
    const r = await enviarPorHttp(await credGestor(s), { arquivo: await jpegPequeno() });
    expect(r.status).toBe(303);
    expect(codigoDoRedirect(r)).toBe('ok');
    expect(r.headers.get('location')).toBe('/painel/configuracoes/fotos?envio=ok');
  });

  it('GET/PUT/DELETE → 405', async () => {
    const cred = await credGestor(s);
    for (const metodo of ['GET', 'PUT', 'DELETE']) {
      const r = await tratarEnvio(new Request(`${APP_URL}/api/painel/fotos`, { method: metodo, headers: { origin: APP_URL } }), {
        executar: (i) => enviarFoto.executar(cred, i),
        appUrl: APP_URL,
      });
      expect(r.status).toBe(405);
    }
  });
});

describe('códigos e destinos do 303', () => {
  it('todo código de envio é de lista fechada; sem sessão → /entrar?proximo= sem ler o arquivo', async () => {
    const r = await enviarPorHttp(null, { arquivo: await jpegPequeno() });
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toBe('/entrar?proximo=%2Fpainel%2Fconfiguracoes%2Ffotos');
    const cred = await credGestor(s);
    for (const [campos, esperado] of [
      [{ arquivo: null }, 'sem_arquivo'],
      [{ arquivo: new Uint8Array([1, 2, 3]) }, 'tipo'],
    ] as const) {
      const codigo = codigoDoRedirect(await enviarPorHttp(cred, campos));
      expect(codigo).toBe(esperado);
      expect(CODIGOS_ENVIO).toContain(codigo);
    }
  });

  it('o corpo não é lido antes da autorização (sem sessão, obterCorpo não é chamado)', async () => {
    let lido = false;
    const req = await requisicaoDeEnvio({ arquivo: await jpegPequeno() });
    await tratarEnvio(req, {
      executar: (i) =>
        enviarFoto.executar(null, {
          obterCorpo: () => {
            lido = true;
            return i.obterCorpo();
          },
        }),
      appUrl: APP_URL,
    });
    expect(lido).toBe(false);
  });

  it('exceção inesperada da ação vira 303 falha (sem 5xx e sem detalhes)', async () => {
    const req = await requisicaoDeEnvio({ arquivo: await jpegPequeno() });
    const r = await tratarEnvio(req, {
      executar: async () => {
        throw new Error('segredo interno');
      },
      appUrl: APP_URL,
    });
    expect(r.status).toBe(303);
    expect(codigoDoRedirect(r)).toBe('falha');
    expect(r.headers.get('location')).not.toContain('segredo');
  });
});
