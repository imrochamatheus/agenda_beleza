import type pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { criarSalaoCompleto } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { jpegPequeno } from '../../support/imagens';
import { aplicarSituacao, impressaoDoSalao } from '../../support/politica';
import type { SituacaoDeTeste } from '../../support/politica';
import { conectar } from '../../support/sql';
import { credGestor, credProfissional, fotosDe } from '../fotos/apoio';
import { codigoDoRedirect, encerrarArmazenamento, enviarPorHttp, prepararArmazenamento } from '../fotos/apoio-servico';
import type { Armazenamento } from '../fotos/apoio-servico';

// D-038 CA-R2: POST /api/painel/fotos (route handler) também obedece à política (capacidade `configurar`).
// 303 com o código de recusa da lista fechada, sem objeto gravado e sem linha.

let c: pg.Client;
let arm: Armazenamento;
beforeAll(async () => {
  c = await conectar();
  arm = prepararArmazenamento();
});
afterAll(async () => {
  encerrarArmazenamento(arm);
  await c.end();
});
afterEach(() => arm.limpar());

async function salaoEm(situacao: SituacaoDeTeste): Promise<SalaoCompleto> {
  const s = await criarSalaoCompleto();
  await aplicarSituacao(s.salaoId, situacao);
  return s;
}

describe.each(['suspensa', 'encerrada', 'manual'] as SituacaoDeTeste[])('salão %s', (situacao) => {
  it('envio recusado: 303 ?envio=negado, nenhum objeto e nenhuma linha; nada mais muda', async () => {
    const s = await salaoEm(situacao);
    const antes = await impressaoDoSalao(c, s.salaoId);
    const r = await enviarPorHttp(await credGestor(s), { arquivo: await jpegPequeno() });
    expect(r.status).toBe(303);
    expect(codigoDoRedirect(r)).toBe('negado');
    expect(r.headers.get('location')).toBe('/painel/configuracoes/fotos?envio=negado');
    expect(arm.objetos()).toEqual([]);
    expect(await fotosDe(c, s.salaoId)).toEqual([]);
    expect(await impressaoDoSalao(c, s.salaoId)).toEqual(antes);
  });
});

describe('salão em situação que permite', () => {
  it.each(['pendente', 'em_teste', 'ativa'] as SituacaoDeTeste[])('%s: o envio segue (303 ?envio=ok)', async (situacao) => {
    const s = await salaoEm(situacao);
    const r = await enviarPorHttp(await credGestor(s), { arquivo: await jpegPequeno() });
    expect(codigoDoRedirect(r)).toBe('ok');
    expect(await fotosDe(c, s.salaoId)).toHaveLength(1);
  });

  it('profissional continua 403 por papel, independentemente do estado (ordem inalterada)', async () => {
    const s = await salaoEm('ativa');
    const r = await enviarPorHttp(await credProfissional(s), { arquivo: await jpegPequeno() });
    expect(codigoDoRedirect(r)).toBe('negado');
    expect(await fotosDe(c, s.salaoId)).toEqual([]);
  });
});
