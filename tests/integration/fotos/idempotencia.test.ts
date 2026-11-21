import { randomUUID } from 'node:crypto';

import type pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { integracoes } from '@/server/integrations/registry';
import { removerFoto } from '@/server/fotos/fotos.acao';

import { criarSalaoCompleto } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { jpegPequeno } from '../../support/imagens';
import { conectar } from '../../support/sql';

import { NAO_ENCONTRADO, UUID_INEXISTENTE, credGestor, fotosDe } from './apoio';
import { codigoDoRedirect, encerrarArmazenamento, enviarPorHttp, prepararArmazenamento } from './apoio-servico';
import type { Armazenamento } from './apoio-servico';

// D-021 T-7: CA-13 (parte serial). O paralelo ×10 está em concorrencia.test.ts (T-8).

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

describe('idempotência (CA-13)', () => {
  it('o mesmo envio repetido: uma linha, resposta ok nas duas, um objeto, sem nova gravação', async () => {
    const cred = await credGestor(s);
    const envio = randomUUID();
    const arquivo = await jpegPequeno();
    expect(codigoDoRedirect(await enviarPorHttp(cred, { arquivo, envio }))).toBe('ok');
    const gravar = vi.spyOn(integracoes().armazenamento, 'gravar');
    expect(codigoDoRedirect(await enviarPorHttp(cred, { arquivo, envio }))).toBe('ok');
    expect(gravar).not.toHaveBeenCalled();
    expect(await fotosDe(c, s.salaoId)).toHaveLength(1);
    expect(arm.objetos()).toHaveLength(1);
  });

  it('token novo com o mesmo arquivo cria outra foto (a deduplicação é por token, não por conteúdo)', async () => {
    const cred = await credGestor(s);
    const arquivo = await jpegPequeno();
    await enviarPorHttp(cred, { arquivo, envio: randomUUID() });
    await enviarPorHttp(cred, { arquivo, envio: randomUUID() });
    expect(await fotosDe(c, s.salaoId)).toHaveLength(2);
  });

  it('remover duas vezes: a primeira remove, a segunda é NaoEncontrado sem chamar o armazenamento', async () => {
    const cred = await credGestor(s);
    await enviarPorHttp(cred, { arquivo: await jpegPequeno() });
    const [f] = await fotosDe(c, s.salaoId);
    const remover = vi.spyOn(integracoes().armazenamento, 'remover');
    expect(await removerFoto.executar(cred, { fotoId: f.id })).toEqual({ ok: true, dados: { resultado: 'removida' } });
    expect(remover).toHaveBeenCalledTimes(1);
    expect(await removerFoto.executar(cred, { fotoId: f.id })).toEqual(NAO_ENCONTRADO);
    expect(await removerFoto.executar(cred, { fotoId: UUID_INEXISTENTE })).toEqual(NAO_ENCONTRADO);
    expect(remover).toHaveBeenCalledTimes(1);
  });
});
