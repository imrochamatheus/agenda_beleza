import type pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { integracoes } from '@/server/integrations/registry';
import { LIMITES_FOTO, MENSAGENS_FOTO } from '@/server/fotos/tipos';

import { criarSalaoCompleto } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import {
  GIF,
  PDF,
  SVG,
  jpegComTamanho,
  jpegPequeno,
  jpegTruncado,
  pngBomba,
  pngComLixo,
  textoComNomeDeFoto,
} from '../../support/imagens';
import { conectar } from '../../support/sql';

import { credGestor, criarFotos, fotografiaFotos, fotosDe, linhaSalao } from './apoio';
import { codigoDoRedirect, encerrarArmazenamento, enviarPorHttp, prepararArmazenamento, requisicaoDeEnvio } from './apoio-servico';
import type { Armazenamento } from './apoio-servico';
import { tratarEnvio } from '@/server/fotos/envio-http';
import { enviarFoto } from '@/server/fotos/fotos.acao';
import { APP_URL } from './apoio-servico';

// D-021 T-7: CA-2. Cada recusa: o código/mensagem da RN, nenhuma linha nova e nenhum arquivo novo.

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

async function recusar(campos: Parameters<typeof enviarPorHttp>[1], esperado: string) {
  const cred = await credGestor(s);
  const salaoAntes = await linhaSalao(c, s.salaoId);
  const fotosAntes = await fotografiaFotos(c, s.salaoId);
  const objetosAntes = arm.objetos();
  const gravar = vi.spyOn(integracoes().armazenamento, 'gravar');
  const r = await enviarPorHttp(cred, campos);
  expect(r.status).toBe(303);
  expect(codigoDoRedirect(r)).toBe(esperado);
  expect(gravar).not.toHaveBeenCalled();
  expect(await fotografiaFotos(c, s.salaoId)).toEqual(fotosAntes);
  expect(await linhaSalao(c, s.salaoId)).toEqual(salaoAntes);
  expect(arm.objetos()).toEqual(objetosAntes);
}

describe('recusas do envio (CA-2)', () => {
  it('5.242.881 bytes → tamanho; 5.242.880 bytes válidos → aceito', async () => {
    await recusar({ arquivo: await jpegComTamanho(LIMITES_FOTO.maxBytes + 1) }, 'tamanho');
    const cred = await credGestor(s);
    const r = await enviarPorHttp(cred, { arquivo: await jpegComTamanho(LIMITES_FOTO.maxBytes) });
    expect(codigoDoRedirect(r)).toBe('ok');
    expect(await fotosDe(c, s.salaoId)).toHaveLength(1);
  });

  it('Content-Length de 50 MB → tamanho, sem ler o corpo', async () => {
    const cred = await credGestor(s);
    const base = await requisicaoDeEnvio({ arquivo: await jpegPequeno() });
    let lido = false;
    const stream = new ReadableStream<Uint8Array>({
      pull() {
        lido = true;
      },
    }, { highWaterMark: 0 });
    const req = new Request(`${APP_URL}/api/painel/fotos`, {
      method: 'POST',
      body: stream,
      headers: { 'content-type': base.headers.get('content-type')!, origin: APP_URL, 'content-length': String(50 * 1024 * 1024) },
      // @ts-expect-error duplex é exigido pelo undici
      duplex: 'half',
    });
    const r = await tratarEnvio(req, { executar: (i) => enviarFoto.executar(cred, i), appUrl: APP_URL });
    expect(codigoDoRedirect(r)).toBe('tamanho');
    expect(lido).toBe(false);
    expect(arm.objetos()).toEqual([]);
  });

  it.each([
    ['PDF', PDF],
    ['GIF', GIF],
    ['SVG', SVG],
    ['texto', textoComNomeDeFoto()],
  ])('%s com nome foto.jpg e Content-Type image/jpeg → tipo', async (_n, arquivo) => {
    await recusar({ arquivo, nome: 'foto.jpg', tipo: 'image/jpeg' }, 'tipo');
  });

  it('JPEG truncado, PNG com cabeçalho e lixo → ilegivel; 100 MP → resolucao', async () => {
    await recusar({ arquivo: await jpegTruncado() }, 'ilegivel');
    await recusar({ arquivo: pngComLixo(), nome: 'a.png', tipo: 'image/png' }, 'ilegivel');
    await recusar({ arquivo: await pngBomba(), nome: 'a.png', tipo: 'image/png' }, 'resolucao');
  }, 60_000);

  it('texto alternativo vazio, só espaços, com 151 caracteres e com quebra de linha; 150 é aceito', async () => {
    const arquivo = await jpegPequeno();
    await recusar({ arquivo, alt: '' }, 'alt_vazio');
    await recusar({ arquivo, alt: '   ' }, 'alt_vazio');
    await recusar({ arquivo, alt: 'a\nb' }, 'alt_vazio');
    await recusar({ arquivo, alt: 'a'.repeat(151) }, 'alt_longo');
    await recusar({ arquivo, alt: null }, 'alt_vazio');
    const cred = await credGestor(s);
    expect(codigoDoRedirect(await enviarPorHttp(cred, { arquivo, alt: 'a'.repeat(150) }))).toBe('ok');
  });

  it('foto ausente ou com 0 bytes → sem_arquivo; token ausente ou não UUID → falha', async () => {
    await recusar({ arquivo: null }, 'sem_arquivo');
    await recusar({ arquivo: new Uint8Array(0) }, 'sem_arquivo');
    const arquivo = await jpegPequeno();
    await recusar({ arquivo, envio: null }, 'falha');
    await recusar({ arquivo, envio: 'nao-uuid' }, 'falha');
  });

  it('a 13ª foto → limite, sem nenhuma chamada de gravação ao armazenamento', async () => {
    await criarFotos(c, s.salaoId, 12);
    await recusar({ arquivo: await jpegPequeno() }, 'limite');
    expect(await fotosDe(c, s.salaoId)).toHaveLength(12);
  });

  it('há uma mensagem pt-BR para cada código de recusa', () => {
    for (const k of ['tamanho', 'tipo', 'ilegivel', 'resolucao', 'limite', 'alt_vazio', 'alt_longo', 'sem_arquivo', 'falha'] as const) {
      expect(MENSAGENS_FOTO[k].length).toBeGreaterThan(10);
    }
  });
});
