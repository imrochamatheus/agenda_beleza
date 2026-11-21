import type pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { editarAltDaFoto, moverFoto, removerFoto } from '@/server/fotos/fotos.acao';
import { integracoes } from '@/server/integrations/registry';

import { criarDoisSaloes } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { jpegPequeno } from '../../support/imagens';
import { conectar } from '../../support/sql';

import { ACESSO_NEGADO, NAO_AUTENTICADO, NAO_ENCONTRADO, credGestor, credProfissional, criarFotos, fotografiaFotos, fotosDe } from './apoio';
import { codigoDoRedirect, encerrarArmazenamento, enviarPorHttp, prepararArmazenamento } from './apoio-servico';
import type { Armazenamento } from './apoio-servico';

// D-021 T-7: CA-4 (isolamento entre salões, papel e sessão).

let c: pg.Client;
let a: SalaoCompleto;
let b: SalaoCompleto;
let arm: Armazenamento;

beforeAll(async () => {
  c = await conectar();
  ({ a, b } = await criarDoisSaloes());
  arm = prepararArmazenamento();
});
afterAll(async () => {
  encerrarArmazenamento(arm);
  await c.end();
});
afterEach(async () => {
  await c.query('DELETE FROM salao_foto WHERE salao_id IN ($1, $2)', [a.salaoId, b.salaoId]);
  arm.limpar();
  vi.restoreAllMocks();
});

describe('isolamento entre salões (CA-4)', () => {
  it('o gestor de S1 não remove, edita nem move foto de S2: 404, S2 idêntico, sem chamar o armazenamento', async () => {
    const [f1, f2] = await criarFotos(c, b.salaoId, 2);
    await criarFotos(c, a.salaoId, 1);
    const antes = await fotografiaFotos(c, b.salaoId);
    const porta = integracoes().armazenamento;
    const espioes = [vi.spyOn(porta, 'remover'), vi.spyOn(porta, 'gravar'), vi.spyOn(porta, 'ler')];
    const cred = await credGestor(a);
    expect(await removerFoto.executar(cred, { fotoId: f1.id })).toEqual(NAO_ENCONTRADO);
    expect(await editarAltDaFoto.executar(cred, { fotoId: f2.id, alt: 'invasão' })).toEqual(NAO_ENCONTRADO);
    expect(await moverFoto.executar(cred, { fotoId: f2.id, direcao: 'cima', posicaoEsperada: 2 })).toEqual(NAO_ENCONTRADO);
    expect(await fotografiaFotos(c, b.salaoId)).toEqual(antes);
    for (const e of espioes) expect(e).not.toHaveBeenCalled();
  });

  it('profissional: as ações devolvem AcessoNegado e o envio dá 303 negado, sem escrita nem gravação', async () => {
    const [f] = await criarFotos(c, a.salaoId, 1);
    const antes = await fotografiaFotos(c, a.salaoId);
    const gravar = vi.spyOn(integracoes().armazenamento, 'gravar');
    const cred = await credProfissional(a);
    expect(await removerFoto.executar(cred, { fotoId: f.id })).toEqual(ACESSO_NEGADO);
    expect(await editarAltDaFoto.executar(cred, { fotoId: f.id, alt: 'x' })).toEqual(ACESSO_NEGADO);
    expect(await moverFoto.executar(cred, { fotoId: f.id, direcao: 'baixo', posicaoEsperada: 1 })).toEqual(ACESSO_NEGADO);
    const r = await enviarPorHttp(cred, { arquivo: await jpegPequeno() });
    expect(r.status).toBe(303);
    expect(codigoDoRedirect(r)).toBe('negado');
    expect(gravar).not.toHaveBeenCalled();
    expect(await fotografiaFotos(c, a.salaoId)).toEqual(antes);
    expect(arm.objetos()).toEqual([]);
  });

  it('sem sessão: as ações devolvem 401 e o envio redireciona para /entrar sem ler o arquivo', async () => {
    const [f] = await criarFotos(c, a.salaoId, 1);
    expect(await removerFoto.executar(null, { fotoId: f.id })).toEqual(NAO_AUTENTICADO);
    expect(await editarAltDaFoto.executar(null, { fotoId: f.id, alt: 'x' })).toEqual(NAO_AUTENTICADO);
    const r = await enviarPorHttp(null, { arquivo: await jpegPequeno() });
    expect(r.headers.get('location')).toBe('/entrar?proximo=%2Fpainel%2Fconfiguracoes%2Ffotos');
    expect(await fotosDe(c, a.salaoId)).toHaveLength(1);
  });

  it('o gestor que também é profissional tem o mesmo acesso do gestor', async () => {
    const r = await enviarPorHttp(await credGestor(a), { arquivo: await jpegPequeno() });
    expect(codigoDoRedirect(r)).toBe('ok');
    expect(await fotosDe(c, a.salaoId)).toHaveLength(1);
    expect(await fotosDe(c, b.salaoId)).toEqual([]);
  });
});
